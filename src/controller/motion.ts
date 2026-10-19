import { Quaternion, Vector3 } from "three";
import { clamp, DEG } from "../flight/aerodynamics";
import { POSTURE } from "../flight/posture";

const UP = new Vector3(0, 1, 0);
export const TABLE_CAPTURE_SECONDS = 2;

export interface TableReference {
  up: number[];
  bias: number[];
}

function tilt(up: Vector3) {
  return { pitch: Math.atan2(-up.z, Math.hypot(up.x, up.y)), roll: Math.atan2(-up.x, up.y) };
}

/** Six-axis attitude filter. Sensor axes: X right, Y up, Z toward the player. */
export class MotionFilter {
  orientation = new Quaternion();
  bias = new Vector3();
  reference: TableReference | null = null;
  private tableFrame = new Quaternion();
  private accelerationSum = new Vector3();
  private gyroSum = new Vector3();
  private gyroActivity = 0;
  private accelerationActivity = 0;
  initialized = false;
  previousTimestamp: number | null = null;
  calibrationSeconds = 0;
  calibrating = false;

  get calibrated() {
    return this.reference !== null;
  }

  get tableAngles() {
    return this.reference ? tilt(new Vector3().fromArray(this.reference.up)) : null;
  }

  restore(reference: TableReference) {
    this.reference = reference;
    this.bias.fromArray(reference.bias);
    this.tableFrame.setFromUnitVectors(new Vector3().fromArray(reference.up).normalize(), UP);
    this.calibrating = false;
  }

  beginCalibration() {
    this.calibrating = true;
    this.resetCapture();
  }

  resetCapture() {
    this.calibrationSeconds = 0;
    this.accelerationSum.set(0, 0, 0);
    this.gyroSum.set(0, 0, 0);
    this.gyroActivity = 0;
    this.accelerationActivity = 0;
  }

  update(gyro: Vector3, acceleration: Vector3, timestamp: number) {
    const delta =
      this.previousTimestamp === null
        ? 0
        : ((timestamp - this.previousTimestamp) >>> 0) / 3_000_000;
    this.previousTimestamp = timestamp;
    const magnitude = acceleration.length();
    const gravityValid = magnitude > 0.8 && magnitude < 1.2;
    if (!this.initialized && gravityValid) {
      this.orientation.setFromUnitVectors(acceleration.clone().normalize(), UP);
      this.initialized = true;
    }
    if (!this.initialized || delta <= 0) return;
    if (delta > 0.1) {
      this.resetCapture();
      return;
    }
    if (this.calibrating) {
      const average =
        this.calibrationSeconds > 0
          ? this.accelerationSum.clone().divideScalar(this.calibrationSeconds)
          : acceleration;
      // Judge motion over roughly 100 ms so isolated sensor spikes do not
      // restart capture. Squared magnitudes keep opposite movements from cancelling.
      const smoothing = 1 - Math.exp(-delta / 0.1);
      this.gyroActivity += (gyro.lengthSq() - this.gyroActivity) * smoothing;
      this.accelerationActivity +=
        (acceleration.distanceToSquared(average) - this.accelerationActivity) * smoothing;
      if (gravityValid && this.gyroActivity < DEG ** 2 && this.accelerationActivity < 0.01 ** 2) {
        this.gyroSum.addScaledVector(gyro, delta);
        this.accelerationSum.addScaledVector(acceleration, delta);
        this.calibrationSeconds += delta;
        if (this.calibrationSeconds >= TABLE_CAPTURE_SECONDS) {
          const up = this.accelerationSum.clone().normalize();
          this.orientation.setFromUnitVectors(up, UP);
          this.restore({
            up: up.toArray(),
            bias: this.gyroSum.clone().divideScalar(this.calibrationSeconds).toArray(),
          });
        }
      } else this.resetCapture();
    }
    const rate = gyro.clone().sub(this.bias);
    if (gravityValid) {
      const expected = UP.clone().applyQuaternion(this.orientation.clone().invert());
      const error = new Vector3().crossVectors(acceleration.clone().normalize(), expected);
      rate.addScaledVector(error, 2 * (1 - Math.abs(magnitude - 1) / 0.2));
    }
    const speed = rate.length();
    if (speed > 0)
      this.orientation
        .multiply(new Quaternion().setFromAxisAngle(rate.divideScalar(speed), speed * delta))
        .normalize();
  }

  angles() {
    // Correct the sensor frame using the saved table pose; world yaw stays free.
    const up = UP.clone()
      .applyQuaternion(this.orientation.clone().invert())
      .applyQuaternion(this.tableFrame);
    return tilt(up);
  }

  commands(invertPitch = false, invertRoll = false) {
    const angles = this.angles();
    // Small soft center, then approximately 1:1 posture targets in radians.
    const target = (angle: number, limit: number) => {
      const magnitude = Math.abs(angle);
      const softened = magnitude < 2 * DEG ? (magnitude * magnitude) / (2 * DEG) : magnitude;
      return clamp(Math.sign(angle) * softened, -limit, limit);
    };
    return {
      pitch: target(angles.pitch, POSTURE.pitchLimit) * (invertPitch ? -1 : 1),
      roll: target(angles.roll, POSTURE.rollLimit) * (invertRoll ? -1 : 1),
    };
  }
}
