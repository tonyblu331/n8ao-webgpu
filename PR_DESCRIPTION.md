## Summary

This is a great implementation of N8AO, and I'm looking forward to contributing to it.

This PR keeps the upstream mental model intact while modernizing one internal implementation detail: the noise source used for stochastic kernel rotation.

It keeps all public configuration names, defaults, quality presets, display modes, transparency conventions, and the AO/denoise/composite pipeline exactly as they are.

The only change is replacing the vendored blue-noise texture asset with **IGN (Interleaved Gradient Noise)**, originally presented by Jorge Jimenez in the Call of Duty: Advanced Warfare post-processing work:

https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare

A more detailed explanation of how IGN works as a low-discrepancy grid is here:

https://blog.demofox.org/2022/01/01/interleaved-gradient-noise-a-different-kind-of-low-discrepancy-sequence/

The formula used is the standard IGN form:

```txt
IGN(x, y) = fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y))
```

This preserves the same stochastic sampling role as the previous blue-noise texture, but removes the texture asset, texture allocation, sampler binding, and noise texture fetch from the WebGPU/TSL path.

## Why this change

The previous implementation preserved the upstream `BlueNoise.js` asset, which makes sense from a compatibility point of view. At the same time, in the WebGPU/TSL port, that asset is only used as an internal source of per-pixel variation for AO and blur kernel rotation.

That means we can preserve the same public behavior and mental model while making this part of the implementation lighter:

* no texture asset
* no texture upload
* no sampler binding
* no noise texture fetch
* no new dependency
* no public API change

IGN gives us a compact textureless alternative for this specific role. It is just a few ALU operations in the shader:

```txt
dot -> fract -> multiply -> fract
```

So this PR is not trying to claim that IGN is universally "better than blue noise." Blue noise is still a strong sampling pattern. The goal here is narrower and more practical:

> keep N8AO behaving like N8AO, but remove an internal texture dependency that is not needed for the WebGPU/TSL implementation.

## What changed

| File               | Change                                        |
| ------------------ | --------------------------------------------- |
| `src/BlueNoise.js` | Deleted vendored blue-noise texture asset     |
| `src/N8AONode.ts`  | Replaced blue-noise texture sampling with IGN |

## Implementation details

The implementation uses IGN from integer pixel coordinates, matching the original formulation:

```txt
pixelPosition = floor(uv * resolution)
```

For temporal animation, it follows the official IGN scroll:

```txt
pixel + 5.588238 * frame
```

The frame index is wrapped to 64 frames on the CPU before being passed to the shader uniform, following the common IGN implementation note to avoid numerical drift.

When accumulation is disabled, the frame value stays at `0`, so the noise remains stable instead of shimmering.

For AO sampling, IGN is used for:

* kernel rotation
* sample offset

For blur/denoise, IGN is kept stable and spatially offset per blur iteration, so the denoise kernel does not shimmer over time.

This keeps the GPU path branchless and textureless for noise generation.

## Bundle impact

Removing the vendored blue-noise asset reduces the bundle size:

| Before   | After   | Difference        |
| -------- | ------- | ----------------- |
| 144.7 KB | 58.9 KB | -85.8 KB / -59.3% |

## Performance

Representative benchmark results from the included benchmark scenes:

| Scene       | Baseline (ms) | IGN (ms) | Difference |
| ----------- | ------------- | -------- | ---------- |
| Helmet AO   | 0.0605        | 0.0570   | -0.0035 ms |
| Interior AO | 0.0625        | 0.0545   | -0.0080 ms |

These numbers should be read as a small runtime improvement, not as an AO rewrite. The main benefit is that the WebGPU/TSL path no longer needs the blue-noise asset, texture allocation, sampler binding, or texture fetch.

## Visual comparison

Side-by-side AO screenshots are attached below for review. They are for this PR thread only and are not included in the diff.

| Helmet AO | Interior AO |
|-----------|-------------|
| `![helmet-sidebyside-ao](PASTE_URL_AFTER_DRAG)` | `![interior-sidebyside-ao](PASTE_URL_AFTER_DRAG)` |

The expected result is intentionally conservative:

* same AO algorithm
* same public API
* same defaults
* same quality presets
* same display modes
* same transparency conventions
* same denoise/composite pipeline

In other words, this should still feel like N8AO, just with a lighter internal noise path for WebGPU/TSL.
