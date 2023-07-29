import clsx from 'clsx';
import {type ComponentProps} from 'react';
import {SkeletonIcon} from '@/components/icons';

type DivProps = ComponentProps<'div'>;

type InteractionAreaProps = Omit<DivProps, 'className' | 'children'> & {
  icon: React.ReactNode;
  title: string;
};

const baseClass = clsx(
  'flex select-none flex-col items-center gap-1 rounded-md border border-dashed border-gray-4 p-4 text-center text-gray-5 sm:p-8',
);

export function InteractionArea({icon, title, ...rest}: InteractionAreaProps) {
  return (
    <div className={baseClass} {...rest}>
      {icon}
      <span>{title}</span>
    </div>
  );
}

export function InteractionAreaSkeleton() {
  return (
    <div className={baseClass}>
      <SkeletonIcon />
      <div className='h-6 w-80 max-w-full bg-gray-5 motion-safe:animate-pulse' />
    </div>
  );
}
