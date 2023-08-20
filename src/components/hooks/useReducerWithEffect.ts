import {useCallback, useRef, useState} from 'react';

/**
 * Synchronously call a callback on every state change.
 *
 * The callback should be idempotent as it may be called multiple times by React.
 */
export const useReducerWithEffect = <
  S extends Record<string, unknown>,
  A extends {type: string},
>(
  initialState: S,
  reducer: (state: S, action: A) => S,
  effect: (state: S) => unknown,
) => {
  const [state, setState] = useState(0);
  const stateRef = useRef(initialState);

  const dispatch = useCallback(
    (action: A) => {
      // Using a ref here means the dispatch function remains stable across renders
      stateRef.current = reducer(stateRef.current, action);
      effect(stateRef.current);
      // But we still want to trigger a re-render and update any UI
      setState((count) => count + 1);
    },
    [effect, reducer],
  );

  return [stateRef.current, dispatch] as const;
};
