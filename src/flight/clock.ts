/** Causal sample-and-hold input: catch-up steps consume their own arrival times. */
export class InputTimeline<T> {
  private pending: { time: number; input: T }[] = [];

  private current: T;

  constructor(input: T) {
    this.current = input;
  }

  reset(input: T) {
    this.pending = [];
    this.current = input;
  }

  push(time: number, input: T) {
    this.pending.push({ time, input });
  }

  sample(time: number) {
    while (this.pending.length && this.pending[0]!.time <= time + 1e-9) {
      this.current = this.pending.shift()!.input;
    }
    return this.current;
  }
}

export class FixedClock {
  accumulator = 0;
  readonly dt = 1 / 120;

  advance(seconds: number, step: (dt: number) => void) {
    // Suspension must be handled by the session, never by catching up old input.
    if (seconds > 0.1 || seconds < 0) {
      this.accumulator = 0;
      return false;
    }
    this.accumulator += seconds;
    while (this.accumulator + 1e-12 >= this.dt) {
      step(this.dt);
      this.accumulator -= this.dt;
    }
    return true;
  }

  get alpha() {
    return Math.max(0, this.accumulator / this.dt);
  }
}
