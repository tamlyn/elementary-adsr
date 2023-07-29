import {Knob, type KnobProps} from './Knob';
import {NormalisableRange} from '@/utils/math';
import {useConst} from '@/components/hooks/useConst';

export type KnobAdrProps = Omit<
  KnobProps,
  'min' | 'max' | 'displayValueFn' | 'mapTo01' | 'mapFrom01'
>;

export function KnobAdr(props: KnobAdrProps) {
  const min = 0.000004; // Limiting to 0.004 ms, because otherwise it'll sound weird when it's too close to the absolute zero
  const max = 60;

  const nr = useConst(() => new NormalisableRange(min, max, 1.88));
  const mapTo01 = (x: number) => nr.mapTo01(x);
  const mapFrom01 = (x: number) => nr.mapFrom01(x);

  return (
    <Knob
      min={min}
      max={max}
      displayValueFn={displayValueFn}
      mapTo01={mapTo01}
      mapFrom01={mapFrom01}
      {...props}
    />
  );
}

const displayValueFn = (s: number) => {
  const ms = s * 1000;

  if (ms < 10) {
    return `${ms.toFixed(2)} ms`;
  }

  if (ms < 100) {
    return `${ms.toFixed(1)} ms`;
  }

  if (ms < 1000) {
    return `${ms.toFixed(0)} ms`;
  }

  if (ms < 10000) {
    return `${s.toFixed(2)} s`;
  }

  return `${s.toFixed(1)} s`;
};
