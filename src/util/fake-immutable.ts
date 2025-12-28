/**
 * A fake immutable value that allows its inner data structure to be mutated in place while still triggering re-renders.
 */
class FakeImmutable<T> {
    private readonly inner: T;

    private constructor(value: T) {
        this.inner = value;
    }

    public static create<T>(initial: T) {
        return new FakeImmutable(initial);
    }

    public update(mutator: (value: T) => T | undefined): FakeImmutable<T> {
        const result = mutator(this.inner);
        if (typeof result === 'undefined') return this;
        return new FakeImmutable(result);
    }

    get value() {
        return this.inner;
    }
}

export default FakeImmutable;
