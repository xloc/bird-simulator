import { clamp } from "../flight/aerodynamics";

export class TorqueFeedback {
  filtered = 0;
  level = 0;

  update(aerodynamicTorque: number, comfort: number, dt: number) {
    const maximum = Math.floor(clamp(comfort, 0, 1) * 8);
    // A positive holding torque opposes a squeeze. Never render its absolute value.
    const target = clamp(-aerodynamicTorque / 2.2, 0, 1) * maximum;
    this.filtered += (target - this.filtered) * (1 - Math.exp(-dt / 0.06));
    if (Math.abs(this.filtered - this.level) > 0.65) this.level = Math.round(this.filtered);
    this.level = clamp(this.level, 0, maximum);
    return this.level;
  }

  reset() {
    this.filtered = 0;
    this.level = 0;
  }
}

/** One in-flight write and one replaceable pending value, including priority off. */
export class EffectWriter {
  private pending: [number, number] | null = null;
  private running: Promise<void> | null = null;
  private armed = false;
  private generation = 0;
  private send: (left: number, right: number) => Promise<void>;
  private onError: (error: unknown) => void;

  constructor(
    send: (left: number, right: number) => Promise<void>,
    onError: (error: unknown) => void,
  ) {
    this.send = send;
    this.onError = onError;
  }

  async arm() {
    const generation = this.generation + 1;
    await this.off();
    if (generation === this.generation) this.armed = true;
  }

  update(left: number, right: number) {
    if (!this.armed) return;
    this.pending = [left, right];
    void this.drain();
  }

  off() {
    this.generation++;
    this.armed = false;
    this.pending = [0, 0];
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.pump().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pump() {
    while (this.pending) {
      const value = this.pending;
      this.pending = null;
      try {
        await this.send(...value);
      } catch (error) {
        this.armed = false;
        this.pending = null;
        this.generation++;
        // If a nonzero send failed, make one best-effort reset before reporting failure.
        if (value[0] || value[1]) {
          try {
            await this.send(0, 0);
          } catch {
            /* Device may be gone. */
          }
        }
        this.onError(error);
        return;
      }
    }
  }
}
