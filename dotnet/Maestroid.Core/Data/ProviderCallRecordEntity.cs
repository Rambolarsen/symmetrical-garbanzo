using System.ComponentModel.DataAnnotations;

namespace Maestroid.Core.Data;

/// <summary>
/// Records a single LLM provider call for cost tracking and audit.
/// Written by trackedGenerate() in the TS sidecar via POST /api/provider-calls,
/// and by the .NET ProviderRegistry for calls it makes directly.
/// </summary>
public class ProviderCallRecordEntity
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    /// <summary>Optional — links to a work package if part of an orchestration run</summary>
    [MaxLength(100)]
    public string? WorkPackageId { get; set; }

    /// <summary>Optional — links to an execution phase</summary>
    [MaxLength(100)]
    public string? PhaseId { get; set; }

    /// <summary>Which ProviderConfig instance handled this call</summary>
    [Required, MaxLength(100)]
    public string InstanceId { get; set; } = "";

    /// <summary>"anthropic" | "openai" | "google" | "ollama"</summary>
    [Required, MaxLength(50)]
    public string Provider { get; set; } = "";

    [Required, MaxLength(200)]
    public string Model { get; set; } = "";

    /// <summary>"fast" | "balanced" | "powerful"</summary>
    [Required, MaxLength(20)]
    public string Tier { get; set; } = "";

    /// <summary>"general" | "claude-code" | "opencode" | "codex"</summary>
    [Required, MaxLength(50)]
    public string Consumer { get; set; } = "general";

    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }

    /// <summary>Calculated cost in USD (0 for local models)</summary>
    public decimal CostUsd { get; set; }

    public int DurationMs { get; set; }

    /// <summary>True when a previous instance was tried and failed before this one</summary>
    public bool WasEscalated { get; set; }
}
