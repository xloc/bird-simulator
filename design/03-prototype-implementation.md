# Implementation architecture

The current application connects WebHID controls, manual wing strokes, aerodynamic posture assistance, rigid-body flight and independent trigger resistance. The [game design](01-bird-simulator.md) defines the interaction; the [aerodynamic model](02-aerodynamic-model.md) defines forces, joint coordination and energy accounting.

## Source ownership

| Module | Responsibility |
| --- | --- |
| [controller/device.ts](../src/controller/device.ts) | WebHID connection, transport selection and motion freshness |
| [controller/protocol.ts](../src/controller/protocol.ts) | Input parsing, factory calibration and trigger-effect packets |
| [controller/motion.ts](../src/controller/motion.ts) | IMU attitude estimation, tabletop capture and posture targets |
| [controller/preferences.ts](../src/controller/preferences.ts) | Saved reference and user settings |
| [controller/feedback.ts](../src/controller/feedback.ts) | Torque-to-resistance mapping and serialized output |
| [flight/model.ts](../src/flight/model.ts) | Joint geometry/coordination, load evaluation, body integration and trim |
| [flight/aerodynamics.ts](../src/flight/aerodynamics.ts) | Strip forces and lift/drag coefficients |
| [flight/posture.ts](../src/flight/posture.ts) | Attitude feedback and bounded joint allocation |
| [flight/clock.ts](../src/flight/clock.ts) | Fixed simulation steps and timestamped input history |
| [flight/recorder.ts](../src/flight/recorder.ts) | Compact flight samples, summaries and upload batches |
| [session.ts](../src/session.ts) | Pinia session lifecycle, settings, telemetry and subsystem orchestration |
| [FlightScene.vue](../src/components/FlightScene.vue) | Bird/environment rendering, camera and frame callback |
| [App.vue](../src/App.vue) | Flight controls, calibration prompt and desktop lab |
| [dev/flight-logs.ts](../dev/flight-logs.ts) | Development-only local log persistence |

The flight model owns body and joint state and runs without a DOM, controller or renderer. Pinia owns shared session/UI state. Mutable model and Three.js objects remain outside deep Vue reactivity; telemetry is sampled from the model.

## Runtime flow and timing

Controller reports become normalized trigger travel and tabletop-relative posture targets. Physics consumes those commands, coordinates joints, evaluates forces and integrates the body. The resulting geometry drives rendering, and shoulder torque drives feedback.

| Activity | Scheduling |
| --- | --- |
| HID input | Process reports as they arrive; measure delivery rate |
| IMU estimation | Each fresh full motion sample, using sensor timestamps |
| Input consumption | Latest sample available at each physics step's time |
| Physics and work accumulation | Fixed 120 Hz |
| Rendering | Display refresh; interpolate body position and orientation |
| Trigger output | Approximately 60 Hz, independently of rendering |
| UI telemetry and detailed logs | Approximately 10 Hz |

Arrival timestamps make input consumption causal: catch-up steps do not receive future trigger changes from the latest render frame. The measured 60 Hz Bluetooth and 250 Hz USB rates are observations from the user's setup, not configured or guaranteed controller rates.

Starting or resuming synchronizes joint geometry with current inputs before integration, preventing movement while paused from becoming an artificial stroke impulse. Frames longer than 100 ms pause the simulation instead of integrating a large backlog.

## Controller adapter and lifecycle

The adapter supports DualSense and DualSense Edge identifiers, with separate USB and Bluetooth framing behind the same normalized input interface. Full reports carry triggers, gyro, acceleration and sensor time. Minimal Bluetooth reports cannot enable motion-controlled flight.

Reading feature report 0x05 requests extended reporting and attempts factory sensor calibration. A visible status identifies nominal sensor scaling when valid factory data is unavailable. Timestamp wrap and repeated samples are handled separately from report arrival rate.

The session loads a saved tabletop reference on connection. Missing references are captured only after Start flight or explicit Reset neutral point. Capture stores averaged gravity and gyro bias; completion leaves flight paused. Normal start and independent trigger tests use a three-second countdown.

USB and Bluetooth output encode independent trigger channels, with Bluetooth sequence framing and CRC32. The writer allows one send in flight and one replaceable pending value, so old resistance commands do not accumulate.

Pause, reset, page hiding, stale motion beyond 250 ms, ground contact, disconnect and output failure stop flight and clear pending nonzero effects. An effects-off packet is requested while the controller remains reachable. A physical disconnect cannot guarantee final delivery.

## Rendering and toolchain

Vue 3, Pinia, TypeScript, Three.js and TresJS core form a single client application. The scene uses procedural geometry; wing strips display the same positions, chords and normals used by physics. The camera follows horizontal heading with a world-up horizon. Body pose is interpolated; strips use the latest physics state.

The environment provides ground, trees and a river as visual motion references. The river is a single indexed ribbon above the ground, with shared edges and a depth bias. Ground contact remains a simple flight-end condition.

pnpm manages the project. Vite+ owns development, checks, tests, formatting and builds; Vue SFC type checking runs through `vue-tsc`. Tailwind is integrated through its Vite plugin. Commands and pinned dependencies are defined in [package.json](../package.json); build/test plugins are configured in [vite.config.ts](../vite.config.ts).

## Automatic local flight diagnostics

During development, each flight start/resume creates a recording. The browser uploads compact batches about every two seconds to the local dev server and flushes on stop, including a final ground-contact sample. The developer can read the saved files directly without a manual export.

| Data | Retention |
| --- | --- |
| Detailed numeric samples | Latest 1,200 rows, approximately two minutes at 10 Hz |
| Reduced overview | Latest 1,800 rows, approximately 30 minutes at 1 Hz |
| Flight files | Five most recently updated recordings |
| Latest-flight summary | `.flight-logs/latest.json`, pointing to its recording |

Column names are stored once and sample values are rounded numeric arrays. Each recording includes the settings, controller/transport information, tabletop reference and model parameters needed to interpret it.

Detailed samples separate commanded posture from actual attitude and record triggers, shoulder/feather/fold/tail state, airflow, forces, moments, stall indicators, input freshness and energy/work counters. Summaries identify large bank errors, angular rates, low speed/height and control saturation.

Cumulative work is integrated at physics frequency, so energetic losses remain measurable even when short power peaks fall between log samples. The 10 Hz input trace supports diagnosis and approximate replay, not exact reconstruction of every controller report.

The local endpoint and persistence middleware exist only in development; production builds do not include them.

## Verification focus

Numerical checks exercise manual partial strokes and holds, released-wing assistance, pitch/bank tracking, complete stroke-cycle energy and sustained climbing. They also check physical force properties, trim, timestep sensitivity and independence from render cadence.

Controller checks cover report parsing, calibration, timestamps, channel ordering, Bluetooth checksums and output/session lifecycle. Recorded flights connect those checks to observed target tracking, joint behavior and energy balance. Changes should receive focused checks of the affected behavior rather than an expanding catalogue of historical tuning results.
