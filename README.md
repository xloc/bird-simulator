# Bird simulator

A browser flight simulator with independently controlled wings and DualSense adaptive-trigger feedback. L2/R2 control wing strokes, and controller tilt guides the bird's posture. A desktop mode is available without a controller.

Built with Vue 3, TresJS/Three.js, Tailwind CSS, and Vite+.

## Getting started

Use Node 24.15 or later in the Node 24 series and pnpm 11.21.0.

```sh
pnpm install
pnpm dev
```

Open the printed localhost URL in desktop Chrome or Edge for WebHID controller support. DualSense connections support USB and Bluetooth. Follow the in-game setup prompts before flying.

## Development

```sh
pnpm check
pnpm check:vue
pnpm test
pnpm build
pnpm fmt
```

## Project notes

This is an experimental simulator; its aerodynamics and controller behavior are still being developed.

- [Game design](design/01-bird-simulator.md)
- [Aerodynamic model](design/02-aerodynamic-model.md)
- [Implementation notes](design/03-prototype-implementation.md)
