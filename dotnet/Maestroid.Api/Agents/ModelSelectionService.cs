namespace Maestroid.Api.Agents;

/// <summary>
/// Singleton that tracks which model is currently active for the "fast" and "balanced" tiers.
/// Mutations to Fast/Balanced take effect on the next request.
/// </summary>
public class ModelSelectionService(string fast, string balanced, IReadOnlyList<string> available)
{
    public string Fast { get; set; } = fast;
    public string Balanced { get; set; } = balanced;
    public IReadOnlyList<string> Available { get; } = available;
}
