# Design

## One plan, two formats

Everything the VZ library does is format-independent except four numbers: byte count, name offset, name length, and the device-key salt. `voiceShape(format)` takes those and returns the shape functions. `voiceRepository(model, shape, NotFoundError)` returns the repository. `writeBudget(limits)` returns a synth's `takeWrite`. Each synth keeps a thin `lib/<synth>/` that instantiates them and exports the same names `lib/vz/` always had, so the schema files, scripts and tests read the same.

| | VZ | DX7 |
|---|---|---|
| Collection | `vz_voices` | `dx7_voices` |
| Bytes / base64 | 336 / 448 | 155 / 208 (`^[A-Za-z0-9+/]{207}=$`) |
| Name | 322–333 (12) | 145–154 (10) |
| Hash salt | `vz-creator` | `dx7-creator` |
| Write budgets | `VZ_WRITE_*` | `DX7_WRITE_*` (same defaults) |

The salts differ, so the same browser key gives unrelated hashes in the two libraries. The editors make their own keys anyway.

## Telling the types apart

Both node types' documents have identical fields. Pothos resolves `node(id)`'s concrete type with each type's `isTypeOf`, which checked only for `creatorHash`. Each type now also checks `data.length` against its format (448 vs 208). The mutation suite checks a VZ voice still comes back as `VzVoice`, and a DX7 voice as `Dx7Voice`.

## Collection

`scripts/synth-voices-collection.ts` holds the create-or-collMod-and-index logic. `vz-voices-collection.ts` and `dx7-voices-collection.ts` are three-line callers. `dx7_voices` was created with `npm run dx7:collection -- --apply` before the code deploys, so the first save never auto-creates an unvalidated collection.

## Verification

`npm run test:mutations` against a local server on the live data: 211 checks, including the unchanged VZ suite and a DX7 suite. The DX7 suite covers:
- the format and name;
- `SynthPatch` resolution, and the libraries staying apart;
- duplicates and refusals;
- listing, search and update;
- hide and delete.
