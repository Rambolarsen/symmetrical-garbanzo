using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Maestroid.Core.Orchestrator;

public record RepoContextResult(string Name, string GeneratedContext);

/// <summary>
/// Extracts project context from a local folder path or GitHub URL.
/// Produces: folder tree (2-3 levels) + README + tech stack from config files.
/// </summary>
public class RepoContextService(HttpClient httpClient)
{
    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "node_modules", ".git", "bin", "obj", "dist", ".next", "__pycache__",
        ".vs", ".idea", ".vscode", "packages", ".nuget", "coverage",
        "out", "build", "target", ".gradle", ".cache", "tmp", "temp",
        ".turbo", ".parcel-cache", ".svelte-kit"
    };

    public async Task<RepoContextResult> RunAsync(string source, string? githubToken = null, CancellationToken ct = default)
    {
        return source.StartsWith("https://github.com/", StringComparison.OrdinalIgnoreCase)
            ? await ExtractGitHubAsync(source, githubToken, ct)
            : ExtractLocal(source);
    }

    // -------------------------------------------------------------------------
    // Local filesystem
    // -------------------------------------------------------------------------

    private static RepoContextResult ExtractLocal(string rootPath)
    {
        rootPath = rootPath.TrimEnd(Path.DirectorySeparatorChar);

        if (!Directory.Exists(rootPath))
            throw new InvalidOperationException($"Directory not found: {rootPath}");

        var name = Path.GetFileName(rootPath);
        var sb = new StringBuilder();

        // Require a git repository
        if (!IsGitRepo(rootPath))
            throw new InvalidOperationException(
                $"The selected folder is not a git repository. Run 'git init' inside '{rootPath}' or choose a folder that is already a git repo.");

        sb.AppendLine($"Project: {name}");
        sb.AppendLine();
        sb.AppendLine("Structure:");
        sb.AppendLine(name + "/");

        // Use git ls-files (respects .gitignore, cleaner listing)
        var gitTree = GetGitFileTree(rootPath);
        if (!string.IsNullOrWhiteSpace(gitTree))
        {
            sb.Append(gitTree);
        }
        else
        {
            AppendLocalTree(sb, rootPath, "", 0, maxDepth: 2);
        }

        // Append recent git log for temporal context
        var recentCommits = GetRecentCommits(rootPath);
        if (!string.IsNullOrWhiteSpace(recentCommits))
        {
            sb.AppendLine();
            sb.AppendLine("Recent commits:");
            sb.Append(recentCommits);
        }

        var readme = FindLocalReadme(rootPath);
        if (readme is not null)
        {
            sb.AppendLine();
            sb.AppendLine("README:");
            sb.AppendLine(readme.Length > 2000 ? readme[..2000] + "..." : readme);
        }

        var techStack = ExtractLocalTechStack(rootPath);
        if (techStack.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Tech stack (from config files):");
            foreach (var item in techStack)
                sb.AppendLine($"- {item}");
        }

        return new RepoContextResult(name, sb.ToString().Trim());
    }

    private static void AppendLocalTree(StringBuilder sb, string path, string prefix, int depth, int maxDepth)
    {
        if (depth > maxDepth) return;

        List<(string path, bool isDir)> items;
        try
        {
            var dirs = Directory.EnumerateDirectories(path)
                .Where(d => !SkipDirs.Contains(Path.GetFileName(d)))
                .OrderBy(d => d)
                .Select(d => (d, true));

            var files = Directory.EnumerateFiles(path)
                .OrderBy(f => f)
                .Select(f => (f, false));

            items = [.. dirs.Concat(files)];
        }
        catch (UnauthorizedAccessException) { return; }

        for (var i = 0; i < items.Count; i++)
        {
            var (itemPath, isDir) = items[i];
            var isLast = i == items.Count - 1;
            var connector = isLast ? "└── " : "├── ";
            var itemName = Path.GetFileName(itemPath);

            sb.AppendLine(prefix + connector + itemName + (isDir ? "/" : ""));

            if (isDir)
                AppendLocalTree(sb, itemPath, prefix + (isLast ? "    " : "│   "), depth + 1, maxDepth);
        }
    }

    private static bool IsGitRepo(string rootPath)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(
                "git", "rev-parse --git-dir")
            {
                WorkingDirectory       = rootPath,
                UseShellExecute        = false,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                CreateNoWindow         = true,
            };
            using var proc = System.Diagnostics.Process.Start(psi)!;
            proc.WaitForExit();
            return proc.ExitCode == 0;
        }
        catch { return false; }
    }

    private static string GetGitFileTree(string rootPath)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(
                "git", "ls-files --cached --others --exclude-standard")
            {
                WorkingDirectory       = rootPath,
                UseShellExecute        = false,
                RedirectStandardOutput = true,
                CreateNoWindow         = true,
            };
            using var proc = System.Diagnostics.Process.Start(psi)!;
            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
            if (proc.ExitCode != 0 || string.IsNullOrWhiteSpace(output))
                return "";

            var files = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            return BuildTreeFromPaths(files);
        }
        catch { return ""; }
    }

    private static string BuildTreeFromPaths(IEnumerable<string> files)
    {
        // Build a nested dictionary structure: dir → children (dirs + files)
        var root = new SortedDictionary<string, object?>(StringComparer.Ordinal);

        foreach (var file in files)
        {
            var parts = file.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            var current = root;
            for (var i = 0; i < parts.Length - 1; i++)
            {
                if (!current.TryGetValue(parts[i] + "/", out var child) || child is not SortedDictionary<string, object?> childDir)
                {
                    childDir = new SortedDictionary<string, object?>(StringComparer.Ordinal);
                    current[parts[i] + "/"] = childDir;
                }
                current = childDir;
            }
            current[parts[^1]] = null; // null = file leaf
        }

        var sb = new StringBuilder();
        RenderTree(sb, root, "");
        return sb.ToString();
    }

    private static void RenderTree(StringBuilder sb, SortedDictionary<string, object?> node, string prefix)
    {
        var items = node.ToList();
        for (var i = 0; i < items.Count; i++)
        {
            var (name, child) = items[i];
            var isLast = i == items.Count - 1;
            var connector = isLast ? "└── " : "├── ";
            sb.AppendLine(prefix + connector + name);
            if (child is SortedDictionary<string, object?> dir)
                RenderTree(sb, dir, prefix + (isLast ? "    " : "│   "));
        }
    }

    private static string GetRecentCommits(string rootPath)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(
                "git", "log --oneline -5")
            {
                WorkingDirectory       = rootPath,
                UseShellExecute        = false,
                RedirectStandardOutput = true,
                CreateNoWindow         = true,
            };
            using var proc = System.Diagnostics.Process.Start(psi)!;
            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
            return proc.ExitCode == 0 ? output : "";
        }
        catch { return ""; }
    }

    private static string? FindLocalReadme(string path)
    {
        foreach (var name in (string[])["README.md", "readme.md", "README", "readme", "README.txt"])
        {
            var file = Path.Combine(path, name);
            if (!File.Exists(file)) continue;
            try { return File.ReadAllText(file).Trim(); }
            catch { }
        }
        return null;
    }

    private static List<string> ExtractLocalTechStack(string rootPath)
    {
        var items = new List<string>();

        // package.json — search root then one level deep (skip node_modules)
        var packageJson = File.Exists(Path.Combine(rootPath, "package.json"))
            ? Path.Combine(rootPath, "package.json")
            : Directory.EnumerateFiles(rootPath, "package.json", SearchOption.AllDirectories)
                .FirstOrDefault(f => !f.Contains("node_modules") && !f.Contains(Path.DirectorySeparatorChar + "dist" + Path.DirectorySeparatorChar));

        if (packageJson is not null)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(packageJson));
                var root = doc.RootElement;
                var pkgName = root.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
                var pkgDesc = root.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String ? d.GetString() : null;
                var deps = root.TryGetProperty("dependencies", out var dEl) && dEl.ValueKind == JsonValueKind.Object
                    ? dEl.EnumerateObject().Select(p => p.Name).Take(8).ToList()
                    : new List<string>();

                var line = $"Node.js ({Path.GetRelativePath(rootPath, packageJson)})";
                if (!string.IsNullOrWhiteSpace(pkgName)) line = $"{pkgName}: {line}";
                if (!string.IsNullOrWhiteSpace(pkgDesc)) line += $" — {pkgDesc}";
                items.Add(line);
                if (deps.Count > 0)
                    items.Add($"  Key deps: {string.Join(", ", deps)}{(deps.Count == 8 ? ", ..." : "")}");
            }
            catch { }
        }

        // .sln files
        foreach (var sln in Directory.EnumerateFiles(rootPath, "*.sln", SearchOption.AllDirectories))
            items.Add($".NET solution: {Path.GetFileNameWithoutExtension(sln)}");

        // .csproj files (up to 6)
        var csprojs = Directory.EnumerateFiles(rootPath, "*.csproj", SearchOption.AllDirectories).Take(6).ToList();
        if (csprojs.Count > 0)
            items.Add($".NET projects: {string.Join(", ", csprojs.Select(f => Path.GetFileNameWithoutExtension(f)))}");

        // go.mod
        var goMod = Path.Combine(rootPath, "go.mod");
        if (File.Exists(goMod))
        {
            try
            {
                var firstLine = File.ReadLines(goMod).FirstOrDefault();
                items.Add($"Go: {firstLine?.Replace("module ", "").Trim() ?? "unknown"}");
            }
            catch { }
        }

        // Cargo.toml
        var cargo = Path.Combine(rootPath, "Cargo.toml");
        if (File.Exists(cargo))
        {
            try
            {
                var lines = File.ReadAllLines(cargo);
                var nameLine = Array.Find(lines, l => l.TrimStart().StartsWith("name ="));
                var crName = nameLine?.Split('"').ElementAtOrDefault(1);
                items.Add($"Rust: {crName ?? "unknown"} (Cargo.toml)");
            }
            catch { }
        }

        // Python
        if (File.Exists(Path.Combine(rootPath, "requirements.txt")))
            items.Add("Python (requirements.txt)");
        else if (File.Exists(Path.Combine(rootPath, "pyproject.toml")))
            items.Add("Python (pyproject.toml)");

        return items;
    }

    // -------------------------------------------------------------------------
    // GitHub API
    // -------------------------------------------------------------------------

    private async Task<RepoContextResult> ExtractGitHubAsync(string url, string? token, CancellationToken ct)
    {
        var (owner, repo) = ParseGitHubUrl(url);

        // Repo metadata
        string repoName, repoDesc = "", defaultBranch;
        using (var doc = JsonDocument.Parse(await FetchJsonAsync($"https://api.github.com/repos/{owner}/{repo}", token, ct)))
        {
            var root = doc.RootElement;
            repoName = GetStr(root, "name") ?? repo;
            repoDesc = GetStr(root, "description") ?? "";
            defaultBranch = GetStr(root, "default_branch") ?? "main";
        }

        var sb = new StringBuilder();
        sb.AppendLine($"Project: {repoName}");
        if (!string.IsNullOrWhiteSpace(repoDesc))
            sb.AppendLine($"Description: {repoDesc}");
        sb.AppendLine();

        // Tree
        sb.AppendLine("Structure:");
        sb.AppendLine(repoName + "/");
        await AppendGitHubTreeAsync(sb, owner, repo, defaultBranch, token, ct);

        // README
        try
        {
            using var doc = JsonDocument.Parse(await FetchJsonAsync($"https://api.github.com/repos/{owner}/{repo}/readme", token, ct));
            var content = GetStr(doc.RootElement, "content");
            if (content is not null)
            {
                var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(content.Replace("\n", ""))).Trim();
                sb.AppendLine();
                sb.AppendLine("README:");
                sb.AppendLine(decoded.Length > 2000 ? decoded[..2000] + "..." : decoded);
            }
        }
        catch { }

        // Tech stack
        var techStack = await ExtractGitHubTechStackAsync(owner, repo, token, ct);
        if (techStack.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Tech stack (from config files):");
            foreach (var item in techStack)
                sb.AppendLine($"- {item}");
        }

        return new RepoContextResult(repoName, sb.ToString().Trim());
    }

    private async Task AppendGitHubTreeAsync(StringBuilder sb, string owner, string repo, string branch, string? token, CancellationToken ct)
    {
        List<(string path, string type, string sha)> topItems;
        using (var doc = JsonDocument.Parse(await FetchJsonAsync(
            $"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}", token, ct)))
        {
            if (!doc.RootElement.TryGetProperty("tree", out var tree)) return;
            topItems = tree.EnumerateArray()
                .Select(i => (
                    path: GetStr(i, "path") ?? "",
                    type: GetStr(i, "type") ?? "",
                    sha: GetStr(i, "sha") ?? ""))
                .Where(i => !string.IsNullOrEmpty(i.path))
                .OrderBy(i => i.type == "blob" ? 1 : 0) // dirs first
                .ThenBy(i => i.path)
                .ToList();
        }

        // Fetch subdirectory contents (cap at 10 to limit API calls)
        var subTrees = new Dictionary<string, List<(string path, string type)>>();
        var dirsToFetch = topItems.Where(i => i.type == "tree").Take(10).ToList();

        await Task.WhenAll(dirsToFetch.Select(async d =>
        {
            try
            {
                using var doc = JsonDocument.Parse(await FetchJsonAsync(
                    $"https://api.github.com/repos/{owner}/{repo}/git/trees/{d.sha}", token, ct));
                if (doc.RootElement.TryGetProperty("tree", out var sub))
                    subTrees[d.path] = sub.EnumerateArray()
                        .Select(i => (path: GetStr(i, "path") ?? "", type: GetStr(i, "type") ?? ""))
                        .OrderBy(i => i.type == "blob" ? 1 : 0)
                        .ThenBy(i => i.path)
                        .ToList();
            }
            catch { }
        }));

        for (var i = 0; i < topItems.Count; i++)
        {
            var item = topItems[i];
            var isLast = i == topItems.Count - 1;
            var isDir = item.type == "tree";
            var connector = isLast ? "└── " : "├── ";

            sb.AppendLine($"{connector}{item.path}{(isDir ? "/" : "")}");

            if (isDir && subTrees.TryGetValue(item.path, out var children))
            {
                var ext = isLast ? "    " : "│   ";
                for (var j = 0; j < children.Count; j++)
                {
                    var child = children[j];
                    var childIsDir = child.type == "tree";
                    var childConn = j == children.Count - 1 ? "└── " : "├── ";
                    sb.AppendLine($"{ext}{childConn}{child.path}{(childIsDir ? "/" : "")}");
                }
            }
        }
    }

    private async Task<List<string>> ExtractGitHubTechStackAsync(string owner, string repo, string? token, CancellationToken ct)
    {
        var items = new List<string>();

        var pkgContent = await FetchFileContentAsync(owner, repo, "package.json", token, ct);
        if (pkgContent is not null)
        {
            try
            {
                using var doc = JsonDocument.Parse(pkgContent);
                var root = doc.RootElement;
                var pkgName = GetStr(root, "name");
                var pkgDesc = GetStr(root, "description");
                var deps = root.TryGetProperty("dependencies", out var dEl) && dEl.ValueKind == JsonValueKind.Object
                    ? dEl.EnumerateObject().Select(p => p.Name).Take(8).ToList()
                    : new List<string>();
                var line = "Node.js (package.json)";
                if (!string.IsNullOrWhiteSpace(pkgName)) line = $"{pkgName}: {line}";
                if (!string.IsNullOrWhiteSpace(pkgDesc)) line += $" — {pkgDesc}";
                items.Add(line);
                if (deps.Count > 0)
                    items.Add($"  Key deps: {string.Join(", ", deps)}{(deps.Count == 8 ? ", ..." : "")}");
            }
            catch { }
        }

        var goMod = await FetchFileContentAsync(owner, repo, "go.mod", token, ct);
        if (goMod is not null)
            items.Add($"Go: {goMod.Split('\n').FirstOrDefault()?.Replace("module ", "").Trim() ?? "unknown"}");

        var cargo = await FetchFileContentAsync(owner, repo, "Cargo.toml", token, ct);
        if (cargo is not null)
        {
            var nameLine = cargo.Split('\n').FirstOrDefault(l => l.TrimStart().StartsWith("name ="));
            items.Add($"Rust: {nameLine?.Split('"').ElementAtOrDefault(1) ?? "unknown"}");
        }

        return items;
    }

    private async Task<string?> FetchFileContentAsync(string owner, string repo, string path, string? token, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(await FetchJsonAsync(
                $"https://api.github.com/repos/{owner}/{repo}/contents/{path}", token, ct));
            var content = GetStr(doc.RootElement, "content");
            return content is null
                ? null
                : Encoding.UTF8.GetString(Convert.FromBase64String(content.Replace("\n", "")));
        }
        catch { return null; }
    }

    private async Task<string> FetchJsonAsync(string url, string? token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("User-Agent", "Maestroid");
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        if (!string.IsNullOrWhiteSpace(token))
            request.Headers.Add("Authorization", $"Bearer {token}");

        using var response = await httpClient.SendAsync(request, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"GitHub API error {(int)response.StatusCode}: {body.Split('\n').FirstOrDefault()?.Trim() ?? body}");
        }

        return await response.Content.ReadAsStringAsync(ct);
    }

    private static (string owner, string repo) ParseGitHubUrl(string url)
    {
        var uri = new Uri(url);
        var parts = uri.AbsolutePath.Trim('/').Split('/');
        if (parts.Length < 2 || string.IsNullOrEmpty(parts[0]) || string.IsNullOrEmpty(parts[1]))
            throw new InvalidOperationException($"Invalid GitHub URL — expected https://github.com/owner/repo, got: {url}");
        return (parts[0], parts[1]);
    }

    private static string? GetStr(JsonElement el, string property) =>
        el.TryGetProperty(property, out var val) && val.ValueKind == JsonValueKind.String
            ? val.GetString()
            : null;
}
