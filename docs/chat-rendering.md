# Chat rendering

## Decision

Load the complete cached transcript and materialize every message in one `gtk::Box`. This gives the scrollbar exact whole-chat geometry and removes paging transitions entirely. Show a fixed tail preview during construction so GTK's changing adjustment range is never visible. Revisit virtualization when real transcripts approach the measured multi-thousand-message limit.

Do not use either `GtkListView` design for transcripts. Their estimated row heights change during fast scrolling, producing both stalls and scrollbar jumps. WebKit was excluded.

## Designs tested

| Renderer | Shape |
|---|---|
| `block-list` | Former renderer: one virtualized `GtkListView` row per content block |
| `message-list` | Fractal-style: one virtualized `GtkListView` row per message, natural scroll policy |
| `list-box` | Chatty-style: all message rows in `GtkListBox` |
| `box` | Dino-style: all message rows in `GtkBox`, with deferred upper-delta compensation |
| `text-view` | One `GtkTextView`, using tags for text/code and child anchors for tool widgets |

Except for `text-view`, every design uses the same production message and block widgets.

## Method

- Release build; GTK 4.22.4 and libadwaita 1.9.3.
- 900×720 window, 30 warm-up frames, then 120 samples.
- Each frame moves the vertical adjustment by 1,200 px through the middle 20–80% of the transcript.
- `upper` changes and unexpected adjustment corrections measure scrollbar instability.
- A 20-message prepend measures synchronous mutation, layout settling, and visible-anchor drift.
- RSS comes from `/proc/self/status` after the run.
- Tables report the median of three independent runs.

Fixtures:

- Cached: the newest 500 messages from a real Sele/Codex chat, containing 648 render blocks.
- Synthetic: 500 messages and 1,750 mixed text, code, tool-call, and tool-result blocks.

## Results

Real cached chat:

| Renderer | Build | p50 | p95 | p99 | Frames >25 ms | `upper` changes | Max value correction | RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `block-list` | 2.2 ms | 26.60 ms | 155.63 ms | 182.38 ms | 65/120 | 109/120 | 10,086 px | 141.0 MiB |
| `message-list` | 2.2 ms | 26.05 ms | 129.11 ms | 171.39 ms | 62/120 | 94/120 | 6,808 px | 141.4 MiB |
| `list-box` | 24.9 ms | 13.34 ms | 13.42 ms | 13.55 ms | 0/120 | 0/120 | 0 px | 149.5 MiB |
| `box` | 22.4 ms | 13.34 ms | 13.44 ms | 13.52 ms | 0/120 | 0/120 | 0 px | 148.2 MiB |
| `text-view` | 9.0 ms | 13.33 ms | 13.44 ms | 13.47 ms | 0/120 | 0/120 | 0 px | 134.2 MiB |

Adversarial mixed content:

| Renderer | p50 | p95 | p99 | RSS |
|---|---:|---:|---:|---:|
| `block-list` | 23.43 ms | 80.21 ms | 113.90 ms | 147.8 MiB |
| `message-list` | 197.44 ms | 649.38 ms | 838.07 ms | 170.2 MiB |
| `list-box` | 13.34 ms | 13.45 ms | 13.52 ms | 198.4 MiB |
| `box` | 13.34 ms | 13.42 ms | 13.52 ms | 195.5 MiB |
| `text-view` | 13.34 ms | 13.45 ms | 13.53 ms | 147.4 MiB |

The renderer-comparison run used the 75 Hz display, or roughly 13.33 ms per frame. Both materialized containers and `GtkTextView` stay at that cadence; both list views do not.

Prepending 20 real messages moved the visible anchor by 2,421 px in the uncompensated `GtkListBox` and by 0 px in the compensated `GtkBox`. The synthetic fixture produced 10,955 px and 0 px respectively. The `GtkBox` mutation itself took 2.4 ms for real content and 4.2 ms for synthetic content; full settling took 157 ms and 289 ms, including ten required stable display frames.

### Full-materialization scale

The cached Codex session “Migrate Electron harness to Rust” contains 565 messages, 735 blocks, and 731,521 bytes of block text. The complete fixture was duplicated without pagination to test one `GtkBox` at 1×, 2×, 5×, and 10× its real size.

Release build, 120 aggressive scroll frames at 1,200 px per frame on a roughly 165 Hz display; values are medians of three runs:

| Scale | Messages | Build | First stable layout | p50 | p95 | p99 | RSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1× | 565 | 24 ms | 298 ms | 6.06 ms | 6.39 ms | 6.57 ms | 148.6 MiB |
| 2× | 1,130 | 66 ms | 384 ms | 6.06 ms | 6.52 ms | 6.67 ms | 173.5 MiB |
| 5× | 2,825 | 350 ms | 650 ms | 7.24 ms | 11.90 ms | 12.43 ms | 244.2 MiB |
| 10× | 5,650 | 1,365 ms | 1,113 ms | 18.15 ms | 22.79 ms | 23.70 ms | 365.2 MiB |

The adjustment range changed zero times during every scroll run. Full materialization is clearly suitable for the current chat and 2× its size. At 5× it remains inside a 60 Hz frame budget but no longer sustains the display's native cadence. At 10×, construction, memory, and roughly 44–55 FPS scrolling make an unlimited all-widget transcript unsuitable as the only long-term strategy.

### Initial presentation

Building every widget synchronously gives correct geometry but blocks the UI. Splitting construction across frames keeps the UI responsive, but visibly prepending older rows changes the adjustment range during GTK layout. Bottom pinning, upper-delta compensation, smaller batches, and waiting for a stable range still exposed movement, blinking, or a late scroll correction.

The current renderer double-buffers startup:

1. Materialize the final 32 messages in a fixed preview and position it at the bottom.
2. Build the complete transcript underneath it with a 2 ms main-thread budget per frame.
3. Keep the preview unchanged while the full viewport settles for ten stable frames.
4. Replace the preview with the full viewport at the same bottom position.

The user sees the end immediately, while construction and adjustment changes remain hidden. The final transcript still has exact whole-chat geometry and no pagination.

## Consequences

- `GtkBox` keeps arbitrary native, reusable GTK components for Markdown, tools, diffs, terminals, and editors.
- The real fixture costs about 7 MiB more RSS than block virtualization. The adversarial fixture costs about 48 MiB more.
- SQLite loads the complete active transcript in chronological order. The chat view has no page model, scroll triggers, trimming, or anchor compensation.
- GTK widget construction remains on the main thread but uses available time up to a 2 ms budget per frame. The raw benchmark measured 24 ms of construction for the real 565-message chat and 1,365 ms at 5,650 messages.
- Exact whole-chat scrollbar geometry is stable. Startup time, memory, and eventually scrolling—not scrollbar correctness—set the practical limit.
- `GtkTextView` is a useful lower-bound measurement, not the chosen component model. Rich block state would have to be mapped into text tags and child anchors instead of normal message components.

## Reproduce

```sh
cargo build --release --bin transcript-render-bench

for renderer in block-list message-list list-box box text-view; do
  target/release/transcript-render-bench \
    --renderer="$renderer" \
    --messages=500 \
    --frames=120 \
    --pixels-per-frame=1200 \
    --prepend-messages=20
done
```

Add `--provider=<provider> --session=<session-id>` to use a session from the Sele transcript cache instead of synthetic data. Run the loop three times and compare medians.

Use `--copies=<count>` to repeat the same fixture for full-materialization scale tests.
