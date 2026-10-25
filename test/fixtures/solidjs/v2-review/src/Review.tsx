import { createEffect, createSignal } from "solid-js";

const saved = localStorage.getItem("count");

createEffect(async () => {
  await Promise.resolve(saved);
});

const [count] = createSignal(0);

export function Review({ label }: { label: string }) {
  const roll = Math.random();
  return (
    <p>
      {label}
      {roll}
      {count()}
    </p>
  );
}
