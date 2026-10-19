# Bird simulator design

The browser simulator lets the player control each wing with a DualSense trigger, steer by tilting the controller, and feel each wing's aerodynamic load through trigger resistance.

This document describes the current game and control design. The [aerodynamic model](02-aerodynamic-model.md) defines the physics; [implementation architecture](03-prototype-implementation.md) covers runtime structure and diagnostics.

## Flight experience

Flight starts airborne in a trimmed, descending glide. The player supplies energy through manual wing strokes and directs the bird with controller pitch and bank. Both index fingers can stay on L2/R2 throughout ordinary flight; no glide button or thumbstick is needed.

The player controls every stroke's timing, depth, hold and reversal, independently for each wing. Assistance coordinates feathers, wing folding and posture. It does not generate repeated flaps or hold altitude or speed.

A third-person camera keeps the bird and horizon visible. The interface provides connection, start/pause, reset, neutral-point reset, feedback comfort and flight telemetry. Ground contact ends the attempt; reset restores the initial glide. The desktop lab supplies the same trigger and posture inputs through sliders.

## Controls and ownership

| Input | Result |
| --- | --- |
| Squeeze L2 / R2 | Move the corresponding wing toward the bottom of its power stroke |
| Partially release | Move that wing back toward its captured starting pose, with recovery feathering |
| Hold a partial or full pull | Hold the requested stroke position after bounded joint settling |
| Release both triggers | Return to the captured poses, then let posture assistance manage gliding |
| Tilt nose up / down | Set the desired bird pitch |
| Lower one controller grip | Set the desired bank and turn in that direction |
| Rotate the controller about vertical | No heading command |

### Manual strokes and assisted glide

A released wing belongs to posture assistance, which may slowly adjust its shoulder angle within a small range. On engagement, the trigger captures that wing's current shoulder angle as its stroke baseline. Trigger travel then maps from this baseline toward the downstroke limit. Release returns to the same baseline before handing the shoulder back to assistance.

The wing's baseline and the controller's neutral posture are separate references. This allows assistance to use shoulder angles on either side of the extended pose while the player rests on fully released triggers. Trigger reports use their standard full travel; there is no endpoint or midpoint calibration.

Re-engaging during recovery keeps the original baseline. Partial strokes therefore remain continuous without shifting the resting wing position on every press.

During manual movement, assistance may slow the requested shoulder motion while the feathers prepare or attitude is corrected. It cannot reverse that motion or extend it beyond the player's target. Holding a trigger does not initiate another stroke.

### Feather and tail coordination

The player supplies shoulder motion; the simulator manages the secondary joints needed to make it useful:

- A downstroke uses a load-bearing feather orientation relative to each strip's airflow.
- Recovery aligns feathers closer to the airflow and folds the outer wing, reducing the energy taken back during release.
- A held wing settles into a load-bearing configuration.
- Feather steering remains available during every phase, including recovery.

The same aerodynamic calculation produces lift, propulsion, drag and turning moments. A stroke can increase speed or height depending on attitude and airflow. Releasing a trigger aims for a low-loss recovery, but it does not freeze altitude or velocity.

Independent partial strokes, reversals and posture changes provide room for skilled maneuvers without adding another feather-control input.

### Posture tracking

Controller pitch and roll set absolute desired bird attitudes relative to the saved tabletop reference. At the default scale, tilt maps approximately one-to-one outside a soft 2° center, bounded to ±30° pitch and ±55° bank. Holding a controller pose holds that target.

The flight controller compares actual attitude with the target and damps rotation. It allocates corrections across common and differential feathering, tail pitch, tail cant and available shoulder motion, using their current aerodynamic effects. This accounts for wing pose, local airflow and stall.

Body orientation still follows physical forces and moments. Limited airflow, actuator limits and asymmetric strokes can limit tracking. Yaw follows the banked turn with sideslip and yaw-rate correction; there is no controller-yaw input or heading lock.

## Calibration and motion estimation

Connecting the controller loads available factory sensor calibration and a saved tabletop reference. Neither connection nor page loading starts neutral capture.

Selecting Start flight without a reference opens an inline prompt to place the controller face up on a level table and let go. Two seconds of low gyro activity and stable acceleration capture the average gravity direction and residual gyro bias. Smoothed activity tolerates isolated noisy reports; sustained movement restarts capture. The resting sensor angle is measured, not assumed to be zero.

The reference is stored in browser storage by controller vendor/product ID and reused across reconnects and reloads. It does not drift toward a held gesture or get recaptured at every start. Before flight, **Reset neutral point** clears it and opens the same capture prompt. Capture finishes with flight paused so the player can pick up the controller before the ordinary three-second Start countdown.

Still IMU readings alone cannot prove the controller is on a table; the prompt establishes the intended placement. Units of the same controller model share the stored reference.

A quaternion attitude filter integrates bias-corrected gyro samples and uses gravity to correct pitch and roll when acceleration is trustworthy. The saved tabletop frame converts the estimate into pitch/bank targets. Sensor timestamps drive estimation independently of rendering; gravity supplies no absolute heading reference.

## Controller feedback

WebHID handles both input and independent adaptive-trigger output over USB or Bluetooth. A browser with WebHID support and a secure context is required; the Connect action opens device selection. Full motion reports are required for controller flight.

Each trigger resists the aerodynamic shoulder torque opposing that wing's inward stroke. The comfort setting scales the output ceiling without changing flight forces. Filtering, hysteresis and discrete strength levels keep feedback usable.

Adaptive triggers reproduce bounded resistance, not calibrated bidirectional joint torque or measured finger force. Signed shoulder torque remains available in diagnostics.

Pause, stale motion input, page hiding, ground contact and disconnect stop flight and clear pending nonzero effects. Effects-off is sent while communication remains available.

## Application and scope

The application uses Vue 3 and Pinia for interface/session state, TypeScript for the model, and Three.js with TresJS core for the scene. pnpm manages dependencies; Vite+ supplies development, checks, tests, formatting and builds. Tailwind CSS is the styling tool.

TresJS core is sufficient for the procedural bird and environment. The current scene needs no Cientos helpers, additional physics engine or post-processing package. Physics owns body and joint state; the renderer displays it.

The bird is a generic simulated bird, with parameters chosen for usable manual flight. The current scope includes articulated wing aerodynamics, stalls, posture assistance, torque feedback and compact local diagnostics. Species-specific accuracy, takeoff, landing/contact dynamics and spatial weather are outside this model.
