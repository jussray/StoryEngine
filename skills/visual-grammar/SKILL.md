---
name: visual-grammar
description: Shared visual-structure selector for image creation and MAKEVIDEO/LEEVIZE. Converts communication intent into the smallest useful explanatory visual form, fingerprints the choice, and preserves truth, continuity, and outcome-learning boundaries.
version: 1.0
owner: Juss
trigger:
  - /image
  - /imagegen
  - /visual
  - /MAKEVIDEO
  - /makevideo
  - /LEEVIZE
  - image creation
  - video making
---
# Visual Grammar v1

## Mission

Before generating an image or video, decide whether the idea needs an explanatory visual structure. If it does, choose the **smallest structure that makes the idea easier to understand**. Structure is a communication tool, not decoration.

The grammar is shared by still-image creation and `/MAKEVIDEO`. A still uses the structure directly. A video may reveal or animate the same structure over time without changing the underlying meaning.

## Approved structures

| Mode | Use when the viewer needs to understand | Default video behavior |
| --- | --- | --- |
| `handwritten` | a personal annotation, note, or emphasis | stroke reveal |
| `decision_matrix` | options compared against criteria | reveal criteria, then options/tradeoffs |
| `infographic` | several facts, metrics, or takeaways at a glance | reveal fact blocks |
| `canvas` | a whole concept/system on one spatial field | pan/zoom across zones |
| `layers` | stacked systems, abstraction levels, or depth | build layers in order |
| `cycle` | a recurring process or feedback loop | draw/animate the loop |
| `diagram` | relationships, architecture, flow, or causality | build nodes and connectors |
| `roadmap` | future stages, milestones, or gates | travel the milestone path |
| `sketchnotes` | a compact annotated explanation | reveal notes and arrows progressively |
| `iceberg` | visible symptoms versus hidden drivers | surface first, then reveal below |
| `blueprint` | a structured plan, layout, or build spec | draw plan lines progressively |
| `exploded_view` | how components form an object/system | separate and reassemble parts |
| `tree` | hierarchy, taxonomy, inheritance, or branching choices | grow branches from root |
| `timeline` | chronology or change over time | reveal events in time order |

## Selection gate

1. State the viewer's single understanding job.
2. If no structure improves comprehension, use no visual mode. Do not force one.
3. If one does help, pick one primary mode.
4. A second supporting mode is allowed only when it has a different, explicit job. Avoid mode soup.
5. Write a one-sentence rationale.
6. Fingerprint the selection before rendering.

Executable selection and fingerprint rules live in `story-engine/lib/visualGrammar.js`.

## Image creation

For images, the selected mode shapes composition before style:

`intent -> truth class -> visual mode -> information hierarchy -> composition -> style -> render -> QA`

A beautiful image that hides the explanation has failed the job. Readability at the delivery size matters more than ornamental detail.

## Video making

For `/MAKEVIDEO` and `/LEEVIZE`, the selected mode becomes part of the shot/job plan. Use motion to reveal logic, not to make every element move.

Examples:

- a `timeline` should unfold chronologically;
- a `layers` visual should build or peel layers in meaningful order;
- an `exploded_view` should separate/reassemble components while preserving identity and spatial continuity;
- an `iceberg` should make the surface/hidden distinction legible before adding cinematic motion.

The visual mode must not overwrite CreativeCanon, EvidenceCanon, ReleaseCanon, shot continuity, or proof classification.

## Fingerprints, cookies, and jobs

Every structured render should bind at least:

- visual grammar version;
- asset kind (`image` or `video`);
- primary mode;
- optional supporting mode;
- intent;
- rationale;
- truth class;
- composition/reveal behavior;
- selection fingerprint.

Use `bindVisualGrammarToJobSpec()` so the visual choice is embedded in immutable render input. Changing the visual mode or rationale must create a new job identity, not silently mutate an old one.

Continuity cookies and receipts should carry the selection fingerprint when the structure affects subsequent shots or derived assets.

## Truth boundary

A visual structure never upgrades evidence. A polished diagram, blueprint, simulated UI, timeline, or infographic remains illustrative/simulated unless the underlying claim has independent evidence.

Generated product/UI behavior must not be presented as demonstrated runtime proof. Use real browser/device capture for product truth.

## Outcome learning

After delivery, score whether the selected structure achieved the founder/viewer intent.

- successful, outcome-proven visual prompts/modes may be promoted to the reusable visual library;
- unclear or unsuccessful attempts stay in revision memory with failure attribution;
- never delete a miss just to keep the library looking green.

Promote the **pattern plus evidence**, not merely the prettiest frame.

## Done

A structured image/video is done only when:

- the selected mode matches the communication job;
- the information hierarchy is readable at delivery size;
- canon and continuity are preserved;
- truth/proof class is unchanged by presentation polish;
- the selection is fingerprinted and bound to the render job;
- QA/outcome evidence is retained for promotion or revision.
