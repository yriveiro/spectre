import { useEffect, useState } from "react";

export function List(props: { items: string[] }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = String(count);
  }, [count]);

  return (
    <ul className="list" key={count}>
      {props.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
      <button onClick={() => setCount(count + 1)}>{count}</button>
    </ul>
  );
}
