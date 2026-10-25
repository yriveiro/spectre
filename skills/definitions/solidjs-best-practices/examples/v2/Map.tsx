import type { Element } from "solid-js";

export default function Map(props: { fallback?: Element }) {
  return <div class="map">{props.fallback}</div>;
}
