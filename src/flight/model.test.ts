import { describe, expect, it } from "vite-plus/test";
import { Euler, Vector3 } from "three";
import { coefficients, DEG, stripForce } from "./aerodynamics";
import { BIRD, GROUND, FlightModel, NEUTRAL_INPUT, triggerAngle } from "./model";
import { FixedClock, InputTimeline } from "./clock";

const chord = new Vector3(0, 0, -1);
const normal = new Vector3(0, 1, 0);

describe("strip aerodynamics", () => {
  it("has zero force without flow and drag never adds energy, including reverse flow", () => {
    expect(stripForce(new Vector3(), chord, normal, 0.02).force.length()).toBe(0);
    for (let degrees = -180; degrees <= 180; degrees++) {
      const angle = degrees * DEG;
      const flow = new Vector3(0, -10 * Math.sin(angle), -10 * Math.cos(angle));
      const result = stripForce(flow, chord, normal, 0.02);
      expect(result.force.dot(flow)).toBeLessThanOrEqual(1e-10);
      const { lift, drag } = coefficients(angle);
      expect(drag).toBeGreaterThanOrEqual(0);
      expect(Math.abs(lift)).toBeLessThan(1.2);
    }
  });

  it("is quadratic in speed, ignores spanwise flow, and is continuous across stall", () => {
    const v = new Vector3(0, -1, -10);
    const f = stripForce(v, chord, normal, 0.02).force;
    expect(
      stripForce(v.clone().multiplyScalar(2), chord, normal, 0.02).force.distanceTo(
        f.clone().multiplyScalar(4),
      ),
    ).toBeLessThan(1e-10);
    expect(
      stripForce(v.clone().add(new Vector3(100, 0, 0)), chord, normal, 0.02).force.distanceTo(f),
    ).toBeLessThan(1e-10);
    for (const angle of [-25, -12, 12, 25]) {
      const before = coefficients(angle * DEG - 1e-7);
      const after = coefficients(angle * DEG + 1e-7);
      expect(Math.abs(before.lift - after.lift)).toBeLessThan(2e-6);
      expect(Math.abs(before.drag - after.drag)).toBeLessThan(2e-6);
    }
  });
});

describe("manual wings and flight", () => {
  it("maps a pull downward from either a raised or lowered assisted baseline", () => {
    for (const baseline of [-10 * DEG, 8 * DEG]) {
      expect(triggerAngle(0, baseline)).toBe(baseline);
      expect(triggerAngle(1, baseline)).toBeCloseTo(BIRD.strokeDown);
      expect(triggerAngle(0.5, baseline)).toBeGreaterThan(baseline);
      expect(triggerAngle(0.5, baseline)).toBeLessThan(BIRD.strokeDown);
    }
  });

  it("starts in a trimmed descending glide with symmetric loads and shoulder torque signs", () => {
    const model = new FlightModel();
    expect(model.force.length()).toBeLessThan(0.001);
    expect(model.moment.length()).toBeLessThan(0.001);
    expect(model.velocity.y).toBeLessThan(0);
    expect(model.wings[0].torque).toBeLessThan(-0.1);
    expect(model.wings[0].torque).toBeCloseTo(model.wings[1].torque, 10);
    expect(model.jointPower).toBe(0);
    const speed = model.velocity.length();
    const startHeight = model.position.y;
    for (let i = 0; i < 1200; i++) model.step(NEUTRAL_INPUT, 1 / 120);
    expect(model.velocity.length()).toBeCloseTo(speed, 5);
    expect(model.position.y).toBeLessThan(startHeight);
    expect(model.omega.length()).toBeLessThan(1e-6);
  });

  it("captures each resting pose, holds partial strokes and allows independent reversal", () => {
    const model = new FlightModel();
    model.wings[0].angle = -8 * DEG;
    model.wings[1].angle = 6 * DEG;
    model.synchronize(NEUTRAL_INPUT);
    const command = { left: 0.4, right: 0.6, pitch: 0, roll: 0 };
    model.step(command, 1 / 120);
    const targets = model.wings.map((w) => w.target);
    expect(model.wings.map((w) => w.baseline / DEG)).toEqual([-8, 6]);
    for (let i = 0; i < 240; i++) model.step({ ...command, roll: 10 * DEG }, 1 / 120);
    for (const [i, w] of model.wings.entries()) {
      expect(w.angle).toBeCloseTo(targets[i]!, 10);
      expect(w.manual).toBe(true);
      expect(Math.abs(w.rate)).toBeLessThan(1e-10);
    }
    expect(Math.abs(model.jointPower)).toBeLessThan(1e-8);
    model.synchronize(command); // Pausing/resuming must not capture the held position again.
    expect(model.wings.map((w) => w.baseline / DEG)).toEqual([-8, 6]);
    // Reversal may briefly wait for feather preparation; the held wing stays put.
    for (let i = 0; i < 12; i++) {
      model.step({ ...command, right: 0.3 }, 1 / 120);
      expect(model.wings[0].angle).toBeCloseTo(targets[0]!, 10);
      expect(model.wings[1].angle).toBeLessThanOrEqual(targets[1]!);
    }
    expect(model.wings[0].angle).toBeCloseTo(targets[0]!, 10);
    expect(model.wings[1].angle).toBeLessThan(targets[1]!);
    expect(model.wings[1].manual).toBe(true);
  });

  it("returns smoothly to assistance and does not ratchet the baseline during rapid repeats", () => {
    const model = new FlightModel();
    for (let i = 0; i < 120 * 4; i++) {
      const pull = (1 - Math.cos((i / 120) * 4 * Math.PI)) / 2;
      model.step({ ...NEUTRAL_INPUT, left: pull, right: pull }, 1 / 120);
    }
    for (const w of model.wings) expect(Math.abs(w.baseline)).toBeLessThan(0.01 * DEG);
    for (let i = 0; i < 120; i++) {
      const angles = model.wings.map((w) => w.angle);
      model.step(NEUTRAL_INPUT, 1 / 120);
      for (const [j, w] of model.wings.entries())
        expect(Math.abs(w.angle - angles[j]!)).toBeLessThanOrEqual(BIRD.jointSpeed / 120 + 1e-10);
    }
    for (const w of model.wings) {
      expect(w.manual || w.returning).toBe(false);
      expect(Math.abs(w.rate)).toBeLessThanOrEqual(BIRD.assistSpeed + 1e-10);
    }
  });

  it("is invariant to a shared velocity/wind translation", () => {
    const a = new FlightModel();
    const b = new FlightModel();
    const shift = new Vector3(3, 2, -4);
    b.wind.copy(shift);
    b.velocity.add(shift);
    a.step(NEUTRAL_INPUT, 1 / 120);
    b.step(NEUTRAL_INPUT, 1 / 120);
    expect(b.force.distanceTo(a.force)).toBeLessThan(1e-10);
    expect(b.moment.distanceTo(a.moment)).toBeLessThan(1e-10);
  });

  it("turns geometry commands into moments with the intended pitch and bank signs", () => {
    const pitch = new FlightModel();
    pitch.step({ ...NEUTRAL_INPUT, pitch: 0.3 }, 1 / 120);
    expect(pitch.moment.x).toBeGreaterThan(0);
    const bank = new FlightModel();
    bank.step({ ...NEUTRAL_INPUT, roll: 0.3 }, 1 / 120);
    expect(bank.moment.z).toBeLessThan(0);
    expect(bank.orientation.angleTo(bank.previousOrientation)).toBeLessThan(DEG);
  });

  it("balances total mechanical power against joint work and aerodynamic dissipation", () => {
    const model = new FlightModel();
    const before = model.energy;
    model.step({ ...NEUTRAL_INPUT, left: 0.2, right: 0.2 }, 1 / 10000);
    const expectedPower = model.jointPower + model.aerodynamicPower;
    expect(model.jointPower).toBeGreaterThan(0);
    expect((model.energy - before) * 10000).toBeCloseTo(expectedPower, 0);
    expect(model.aerodynamicPower).toBeLessThan(0);
  });

  it("converges under timestep and strip refinement for a partial-stroke input trace", () => {
    const run = (dt: number, strips: number) => {
      const f = new FlightModel(strips);
      for (let t = 0; t < 1 - dt / 2; t += dt) {
        // Prescribed test input, not an automatic control in the application.
        f.step(
          {
            left: 0.2 + 0.15 * Math.sin(t * 4),
            right: 0.2 + 0.12 * Math.sin(t * 4),
            pitch: 0.05,
            roll: 0,
          },
          dt,
        );
      }
      return f;
    };
    const a = run(1 / 120, 8);
    const b = run(1 / 240, 8);
    const c = run(1 / 120, 16);
    expect(a.position.distanceTo(b.position)).toBeLessThan(0.1);
    expect(a.velocity.distanceTo(b.velocity)).toBeLessThan(0.2);
    expect(a.position.distanceTo(c.position)).toBeLessThan(0.1);
    expect(a.velocity.distanceTo(c.velocity)).toBeLessThan(0.2);
  });

  it("adds useful energy through a press and feathered recovery, with bounded disturbance", () => {
    const run = (dt: number) => {
      const f = new FlightModel();
      const initial = f.energy;
      const initialSpeed = f.velocity.length();
      const initialSink = f.velocity.y;
      let maxAngle = 0;
      for (let t = 0; t < 0.6 - dt / 2; t += dt) {
        const pull = t < 0.1 - dt / 2 ? 1 : 0;
        const feathers = f.wings.flatMap((w) => w.surfaces.map((s) => s.incidence));
        f.step({ ...NEUTRAL_INPUT, left: pull, right: pull }, dt);
        const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
        expect(Math.abs(pose.z)).toBeLessThan(DEG);
        expect(Math.abs(pose.x)).toBeLessThan(8 * DEG);
        expect(f.velocity.y).toBeGreaterThan(initialSink - 1);
        maxAngle = Math.max(maxAngle, f.wings[0].angle);
        for (const [i, s] of f.wings.flatMap((w) => w.surfaces).entries())
          expect(Math.abs(s.incidence - feathers[i]!)).toBeLessThanOrEqual(
            BIRD.featherTrackingSpeed * dt + 1e-10,
          );
      }
      // Include recovery to within half a degree of rest, not just the power peak.
      expect(maxAngle).toBeGreaterThan(0.7 * BIRD.strokeDown);
      for (const w of f.wings) {
        expect(Math.abs(w.angle - w.baseline)).toBeLessThan(0.5 * DEG);
        expect(w.fold).toBeLessThan(DEG);
        expect(Math.abs(w.rate)).toBeLessThan(BIRD.assistSpeed);
      }
      const gain = f.energy - initial;
      expect(gain).toBeGreaterThan(1);
      expect(f.velocity.length() - initialSpeed).toBeGreaterThan(0.5);
      expect(f.jointWork).toBeGreaterThan(gain);
      expect(f.aerodynamicWork).toBeLessThan(0);
      expect(Math.abs(gain - f.jointWork - f.aerodynamicWork)).toBeLessThan(0.02 * f.jointWork);
      return gain;
    };
    expect(Math.abs(run(1 / 120) - run(1 / 240))).toBeLessThan(0.15);
  });

  it.each([
    { pitch: 15, cadence: 1.5, shape: "smooth", minimumPower: 0.5 },
    { pitch: 15, cadence: 2, shape: "smooth", minimumPower: 3 },
    { pitch: 15, cadence: 3, shape: "smooth", minimumPower: 8 },
    { pitch: 15, cadence: 2, shape: "quick", minimumPower: 2.5 },
    { pitch: 25, cadence: 2, shape: "quick", minimumPower: 1.5 },
  ])(
    "climbs through repeated $shape strokes at $cadence Hz and $pitch° pitch",
    ({ pitch, cadence, shape, minimumPower }) => {
      const f = new FlightModel();
      const input = { ...NEUTRAL_INPUT, pitch: pitch * DEG };
      for (let i = 0; i < 600; i++) f.step(input, 1 / 120);
      let height = 0,
        energy = 0,
        work = 0,
        dissipation = 0;
      // Settle for four seconds, then measure eight seconds of complete cycles.
      for (let i = 0; i < 1440; i++) {
        if (i === 480) {
          height = f.position.y;
          energy = f.energy;
          work = f.jointWork;
          dissipation = f.aerodynamicWork;
        }
        // Hold each input for two physics steps, matching 60 Hz Bluetooth reports.
        const phase = ((Math.floor(i / 2) / 60) * cadence) % 1;
        const pull =
          shape === "smooth" ? (1 - Math.cos(phase * 2 * Math.PI)) / 2 : Number(phase < 0.35);
        f.step({ ...input, left: pull, right: pull }, 1 / 120);
        const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
        expect(Math.abs(pose.z / DEG)).toBeLessThan(5);
        expect(Math.abs(pose.x / DEG - pitch)).toBeLessThan(8);
      }
      const supplied = f.jointWork - work;
      const lost = f.aerodynamicWork - dissipation;
      // Require real joint-work surplus, not numerical energy from the integrator.
      expect((supplied + lost) / 8).toBeGreaterThan(minimumPower);
      expect((f.position.y - height) / 8).toBeGreaterThan(
        (minimumPower / (BIRD.mass * BIRD.gravity)) * 0.7,
      );
      expect(Math.abs(f.energy - energy - supplied - lost)).toBeLessThan(0.05 * supplied);
      expect(f.grounded).toBe(false);
    },
  );

  it("stays finite through full asymmetric strokes, stalls and ground contact", () => {
    const f = new FlightModel();
    for (let i = 0; i < 3600 && !f.grounded; i++) {
      const phase = i % 240;
      f.step(
        {
          left: phase < 120 ? 0 : 1,
          right: phase < 80 ? 1 : 0,
          pitch: 0.8,
          roll: -0.7,
        },
        1 / 120,
      );
      expect(Number.isFinite(f.energy)).toBe(true);
      expect(f.orientation.length()).toBeCloseTo(1, 8);
    }
    expect(f.grounded).toBe(true);
    const position = f.position.clone();
    f.step(NEUTRAL_INPUT, 1 / 120);
    expect(f.position.y).toBeGreaterThanOrEqual(position.y);
    expect(f.position.y).toBeLessThanOrEqual(GROUND.height);
    expect(f.phase).toBe("walking");
    expect(f.position.distanceTo(position)).toBeLessThan(1);
  });
});

it("steps identically across display rates and rejects a suspended-frame backlog", () => {
  const run = (fps: number) => {
    const clock = new FixedClock();
    const f = new FlightModel();
    for (let i = 0; i < fps * 2; i++) clock.advance(1 / fps, (dt) => f.step(NEUTRAL_INPUT, dt));
    expect(
      clock.advance(2, () => {
        throw new Error("Must not catch up");
      }),
    ).toBe(false);
    return f;
  };
  const a = run(60);
  for (const fps of [30, 144]) {
    const b = run(fps);
    expect(b.position.distanceTo(a.position)).toBeLessThan(1e-10);
    expect(b.time).toBe(a.time);
  }
});

it("replays changing timestamped input identically at 30, 60 and 144 Hz rendering", () => {
  const run = (fps: number) => {
    const f = new FlightModel();
    const clock = new FixedClock();
    const timeline = new InputTimeline(NEUTRAL_INPUT);
    timeline.reset(NEUTRAL_INPUT);
    let delivered = 0;
    let simulationTime = 0;
    for (let frame = 1; frame <= fps * 2; frame++) {
      const wallTime = frame / fps;
      while ((delivered + 1) / 250 <= wallTime + 1e-9) {
        const time = ++delivered / 250;
        timeline.push(time, {
          left: 0.3 + 0.2 * Math.sin(time * 8),
          right: 0.3 + 0.17 * Math.sin(time * 6),
          pitch: 0.1,
          roll: 0,
        });
      }
      clock.advance(1 / fps, (dt) => {
        simulationTime += dt;
        f.step(timeline.sample(simulationTime), dt);
      });
    }
    return f;
  };
  const reference = run(60);
  for (const fps of [30, 144]) {
    const f = run(fps);
    expect(f.position.distanceTo(reference.position)).toBeLessThan(1e-9);
    expect(f.orientation.angleTo(reference.orientation)).toBeLessThan(1e-7);
    expect(f.wings[0].angle).toBeCloseTo(reference.wings[0].angle, 12);
  }
});
