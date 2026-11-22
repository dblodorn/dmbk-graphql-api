# Proposal

## Why

The DX7 editor (dx7.dmbk.io, repo dblodorn/dx7) needs a shared voice list, as vz10m has, and windchime's PATCH picker needs a DX7 library to list. Building it the VZ way twice would copy every file of `lib/vz/`. That's the moment the vz10m plan named for factoring: a second synth showing what's common.

## What Changes

- **A shared synth-voices module** that both libraries use, holding what was VZ-only:
  - `lib/synth-voices/shape.ts`: decode and check, name from the bytes, fingerprint, device-key hash, the collection validator;
  - `lib/synth-voices/repository.ts`: save, update, delete, list, load, hide;
  - `lib/synth-voices/limits.ts`: write budgets;
  - `lib/synth-voices/names.ts`: the obscene-name check;
  - `models/synth-voice.ts`: the document shape and model.
- **VZ voices rebuilt on it, unchanged in behaviour.** The validator is byte-identical (`vz:collection` reports "up to date") and creator hashes are unchanged (same `vz-creator` salt). Every existing export of `lib/vz/` still exists.
- **DX7 voices** in `dmbk-sound.dx7_voices`:
  - the 155 unpacked VCED bytes, base64 (208 characters, one `=`), with the name read from bytes 145–154;
  - a `Dx7Voice` node implementing `SynthPatch`;
  - `dmbkSoundDx7Voices` (search at most 10 characters);
  - `dmbkSoundSaveDx7Voice`, `UpdateDx7Voice`, `DeleteDx7Voice` and `SetDx7VoiceHidden`;
  - its own write budgets (`DX7_WRITE_*`);
  - `npm run dx7:collection`.
- **`VzVoice.isTypeOf` checks the data length too:** both types' documents now have the same fields, so a DX7 voice could otherwise resolve as a `VzVoice` through `node(id)`.
- **`VzWriteRateLimitedError` becomes `VoiceWriteRateLimitedError`:** the same `RATE_LIMITED` code and `retryAfterSeconds`.

## Non-goals

- Importing Yamaha's factory ROM voices (decided separately).
- Banks: the editors keep them on the device.
- Windchime's chime catalog entry for `x:yamaha-dx7` (windchime's `add-dx7-synth`, which runs `chime:collection -- --apply` with the new catalog).

## Capabilities

### New Capabilities
- `dx7-voices`: DX7 voices saved anonymously, on the VZ voices' plan.
