using System.ComponentModel.DataAnnotations;

namespace Maestroid.Core.Data;

/// <summary>
/// User-defined provider entry. Persisted to DB.
/// apiKey is stored encrypted via ASP.NET Core Data Protection.
/// </summary>
public class ProviderConfigEntity
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Display name, e.g. "Local Ollama", "Remote GPU Box"</summary>
    [Required, MaxLength(200)]
    public string Name { get; set; } = "";

    /// <summary>"anthropic" | "openai" | "google" | "ollama"</summary>
    [Required, MaxLength(50)]
    public string Provider { get; set; } = "";

    /// <summary>Override default endpoint (required for Ollama instances)</summary>
    [MaxLength(500)]
    public string? BaseUrl { get; set; }

    /// <summary>Encrypted API key — never stored in plaintext</summary>
    public string? EncryptedApiKey { get; set; }

    public bool IsLocal { get; set; }

    public bool Enabled { get; set; } = true;

    /// <summary>Lower = higher priority within the same provider type</summary>
    public int Priority { get; set; }
}
