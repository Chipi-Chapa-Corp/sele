// Generated from https://developers.openai.com/codex/config-schema.json on 2026-09-06.
// Only structured feature schemas are included; installed Codex still supplies feature availability.
import type { ProviderConfigField } from '../../../shared/provider'

export const codexFeatureSchemas: Record<string, ProviderConfigField> = {
  apps_mcp_path_override: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean'
      },
      path: {
        type: 'string'
      }
    }
  },
  code_mode: {
    type: 'object',
    properties: {
      default_exec_yield_time_ms: {
        description: 'Default yield timeout for code-mode exec calls, in milliseconds.',
        minimum: 0.0,
        type: 'integer'
      },
      direct_only_tool_namespaces: {
        description:
          'Exact tool namespaces to expose only as direct model tools. These tools bypass deferral, remain top-level in code-mode-only sessions, and are omitted from the nested code-mode tool surface.',
        type: 'array',
        items: {
          type: 'string'
        }
      },
      enabled: {
        type: 'boolean'
      },
      excluded_tool_namespaces: {
        description: 'Exact tool namespaces to omit from the code-mode nested tool surface.',
        type: 'array',
        items: {
          type: 'string'
        }
      }
    }
  },
  code_mode_host: {
    type: 'object',
    properties: {
      disable_in_process_fallback: {
        description: 'Keep code mode fail-closed when the standalone host is unavailable.',
        type: 'boolean'
      },
      enabled: {
        type: 'boolean'
      }
    }
  },
  context_management: {
    type: 'object',
    properties: {
      experimental_mode: {
        description: 'Enables experimental context management.',
        type: 'boolean'
      }
    }
  },
  current_time_reminder: {
    type: 'object',
    properties: {
      clock_source: {
        enum: ['system', 'external'],
        type: 'string'
      },
      delivery_mode: {
        type: 'string',
        enum: ['any_inference', 'after_user_or_tool_output']
      },
      enabled: {
        type: 'boolean'
      },
      reminder_interval_seconds: {
        minimum: 0.0,
        type: 'integer'
      },
      sleep_tool: {
        description: 'Expose the input-interruptible `clock.sleep` tool.',
        type: 'boolean'
      }
    }
  },
  guardianv2: {
    description: 'User-configurable prompt, approval, and context settings for Guardian v2.',
    type: 'object',
    properties: {
      classifier_instructions: {
        type: 'string'
      },
      enabled: {
        type: 'boolean'
      },
      free_guardian: {
        description:
          'Route Guardian review and classification through the unmetered Codex endpoints.',
        type: 'boolean'
      },
      max_action_tokens: {
        maximum: 100000.0,
        minimum: 100.0,
        type: 'integer'
      },
      max_classifier_instruction_tokens: {
        maximum: 100000.0,
        minimum: 100.0,
        type: 'integer'
      },
      max_parent_compaction_tokens: {
        maximum: 100000.0,
        minimum: 100.0,
        type: 'integer'
      },
      max_tool_call_lag: {
        minimum: 0.0,
        type: 'integer'
      },
      persist_scores: {
        description: 'Persist reviewed actions and risk scores to rollout files for debugging.',
        type: 'boolean'
      },
      reasoning_effort: {
        description: 'A non-empty reasoning effort value advertised by the model.',
        type: 'string'
      },
      reuse_parent_compaction: {
        type: 'boolean'
      },
      review_scope: {
        description: 'Optional tool-call categories available to the Guardian v2 classifier.',
        type: 'object',
        properties: {
          computer_use_only: {
            description:
              'Restrict asynchronous classification and fast approvals to browser and computer-use tools.',
            type: 'boolean'
          },
          sandboxed_exec_commands: {
            description: 'Include sandboxed shell command calls in Guardian v2 classification.',
            type: 'boolean'
          }
        }
      },
      review_threshold: {
        maximum: 1.0,
        minimum: 0.0,
        type: 'number'
      },
      transcript: {
        description: 'Bounds and optional sources for the Guardian v2 conversation transcript.',
        type: 'object',
        properties: {
          include_images: {
            description: 'Include recent screenshots from messages and configured tool outputs.',
            type: 'boolean'
          },
          max_message_entry_tokens: {
            maximum: 100000.0,
            minimum: 100.0,
            type: 'integer'
          },
          max_message_transcript_tokens: {
            maximum: 100000.0,
            minimum: 100.0,
            type: 'integer'
          },
          max_recent_non_user_entries: {
            minimum: 1.0,
            type: 'integer'
          },
          max_tool_entry_tokens: {
            maximum: 100000.0,
            minimum: 100.0,
            type: 'integer'
          },
          max_tool_transcript_tokens: {
            maximum: 100000.0,
            minimum: 100.0,
            type: 'integer'
          },
          sources: {
            type: 'array',
            items: {
              description: 'Optional conversation sources available to the Guardian v2 classifier.',
              enum: ['tool_calls', 'tool_outputs', 'reasoning'],
              type: 'string'
            }
          }
        }
      }
    }
  },
  multi_agent_v2: {
    type: 'object',
    properties: {
      default_wait_timeout_ms: {
        maximum: 3600000.0,
        minimum: 0.0,
        type: 'integer'
      },
      enabled: {
        type: 'boolean'
      },
      expose_spawn_agent_model_overrides: {
        description:
          'Exposes `model` and `reasoning_effort` on the multi-agent v2 spawn tool and adds corresponding guidance to root and subagent usage hints.',
        type: 'boolean'
      },
      hide_spawn_agent_metadata: {
        type: 'boolean'
      },
      max_concurrent_threads_per_session: {
        minimum: 1.0,
        type: 'integer'
      },
      max_wait_timeout_ms: {
        maximum: 3600000.0,
        minimum: 0.0,
        type: 'integer'
      },
      min_wait_timeout_ms: {
        maximum: 3600000.0,
        minimum: 0.0,
        type: 'integer'
      },
      multi_agent_mode_hint_text: {
        type: 'string'
      },
      non_code_mode_only: {
        type: 'boolean'
      },
      root_agent_usage_hint_text: {
        type: 'string'
      },
      subagent_developer_instructions: {
        description:
          'Overrides inherited developer instructions for subagents without role-specific instructions.',
        type: 'string'
      },
      subagent_usage_hint_text: {
        type: 'string'
      },
      tool_namespace: {
        type: 'string'
      },
      usage_hint_enabled: {
        description: 'Deprecated compatibility field. Its value is ignored.',
        type: 'boolean'
      },
      usage_hint_text: {
        type: 'string'
      },
      wait_agent_enabled: {
        description: 'Expose the multi-agent v2 `wait_agent` tool.',
        type: 'boolean'
      }
    }
  },
  network_proxy: {
    type: 'object',
    properties: {
      allow_local_binding: {
        type: 'boolean'
      },
      allow_upstream_proxy: {
        type: 'boolean'
      },
      credential_broker: {
        type: 'boolean'
      },
      dangerously_allow_all_unix_sockets: {
        type: 'boolean'
      },
      dangerously_allow_non_loopback_proxy: {
        type: 'boolean'
      },
      domains: {
        type: 'object',
        additionalProperties: {
          enum: ['allow', 'deny'],
          type: 'string'
        }
      },
      enable_socks5: {
        type: 'boolean'
      },
      enable_socks5_udp: {
        type: 'boolean'
      },
      enabled: {
        type: 'boolean'
      },
      mode: {
        enum: ['limited', 'full'],
        type: 'string'
      },
      proxy_url: {
        type: 'string'
      },
      socks_url: {
        type: 'string'
      },
      unix_sockets: {
        type: 'object',
        additionalProperties: {
          enum: ['allow', 'deny'],
          type: 'string'
        }
      }
    }
  },
  non_prefixed_mcp_tool_names: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean'
      },
      server_names: {
        description: 'MCP servers whose tools should omit the legacy `mcp__` namespace prefix.',
        type: 'array',
        items: {
          type: 'string'
        }
      }
    }
  },
  rollout_budget: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean'
      },
      limit_tokens: {
        minimum: 1.0,
        type: 'integer'
      },
      prefill_token_weight: {
        minimum: 0.0,
        type: 'number'
      },
      reminder_at_remaining_tokens: {
        description: 'Remaining weighted-token values that trigger reminders when crossed.',
        type: 'array',
        items: {
          type: 'integer'
        }
      },
      sampling_token_weight: {
        minimum: 0.0,
        type: 'number'
      }
    }
  },
  sleep_tool: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean'
      },
      mode: {
        type: 'string',
        enum: ['model_driven', 'always_on']
      }
    }
  },
  token_budget: {
    type: 'object',
    properties: {
      auto_compact_fallback_buffer_tokens: {
        description:
          'Additional tokens available after the compaction threshold for fallback note-taking.',
        minimum: 1.0,
        type: 'integer'
      },
      auto_compact_fallback_prompt: {
        description: 'Developer message sampled before an automatic context-window rollover.',
        type: 'string'
      },
      enabled: {
        type: 'boolean'
      },
      guidance_message: {
        description: 'Guidance appended to the context-window metadata in a developer message.',
        type: 'string'
      },
      reminder_message_template: {
        description:
          'Reminder template. `{n_remaining}` is replaced with the tokens remaining before auto-compaction.',
        type: 'string'
      },
      reminder_threshold_tokens: {
        description:
          'Number of tokens remaining before auto-compaction when the wrap-up reminder is emitted.',
        minimum: 1.0,
        type: 'integer'
      },
      use_history_notes_extension: {
        description: 'Whether to expose the built-in history and notes extension.',
        type: 'boolean'
      }
    }
  },
  tool_registry: {
    type: 'object',
    properties: {
      error_on_tool_collisions: {
        description: 'Fail the turn when multiple tools share the same effective name.',
        type: 'boolean'
      },
      turn_metadata_includes_tool_info: {
        description: 'Include authoritative tool information in per-turn request metadata.',
        type: 'boolean'
      }
    }
  }
}
