"use client";

import {
  type AgentState,
  type TrackReferenceOrPlaceholder,
  useMultibandTrackVolume,
} from "@livekit/components-react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import React, {
  Children,
  type ComponentProps,
  type CSSProperties,
  cloneElement,
  isValidElement,
  memo,
  type ReactNode,
  useMemo,
} from "react";
import {
  type Coordinate,
  useAgentAudioVisualizerGridAnimator,
} from "@/hooks/agents-ui/use-agent-audio-visualizer-grid";
import { cn } from "@/lib/utils";

/**
 * Resizes an array of per-band volume values to exactly `count` entries.
 * Excess values are trimmed from the end; if there are too few, the last
 * value is duplicated to fill the remainder. An empty array is padded with 0s.
 */
export function normalizeVolumeBands(bands: number[], count: number): number[] {
  if (bands.length === count) return bands;
  if (bands.length > count) return bands.slice(0, count);
  const lastValue = bands[bands.length - 1] ?? 0;
  return [...bands, ...new Array(count - bands.length).fill(lastValue)];
}

function cloneSingleChild(
  children: ReactNode | ReactNode[],
  props?: Record<string, unknown>,
  key?: unknown
) {
  return Children.map(children, (child) => {
    // Checking isValidElement is the safe way and avoids a typescript error too.
    if (isValidElement(child) && Children.only(children)) {
      const childProps = child.props as Record<string, unknown>;
      if (childProps.className) {
        // make sure we retain classnames of both passed props and child
        props ??= {};
        props.className = cn(childProps.className as string, props.className as string);
        props.style = {
          ...(childProps.style as CSSProperties),
          ...(props.style as CSSProperties),
        };
      }
      return cloneElement(child, { ...props, key: key ? String(key) : undefined });
    }
    return child;
  });
}

export const AgentAudioVisualizerGridCellVariants = cva(
  [
    "w-1 h-1 rounded-full bg-current/10 place-self-center transition-all ease-out",
    "data-[lk-highlighted=true]:bg-current",
  ],
  {
    defaultVariants: {
      size: "md",
    },
    variants: {
      size: {
        icon: ["w-[2px] h-[2px]"],
        lg: ["w-[12px] h-[12px]"],
        md: ["w-[8px] h-[8px]"],
        sm: ["w-[4px] h-[4px]"],
        xl: ["w-[16px] h-[16px]"],
      },
    },
  }
);

export const AgentAudioVisualizerGridVariants = cva("grid", {
  defaultVariants: {
    size: "md",
  },
  variants: {
    size: {
      icon: ["gap-[2px]"],
      lg: ["gap-[12px]"],
      md: ["gap-[8px]"],
      sm: ["gap-[4px]"],
      xl: ["gap-[16px]"],
    },
  },
});

/**
 * Configuration options for the grid visualizer.
 */
export interface GridOptions {
  /**
   * Additional CSS class names to apply to the container.
   */
  className?: string;
  /**
   * The number of columns in the grid.
   * @defaultValue 5
   */
  columnCount?: number;
  /**
   * The interval in milliseconds between animation frames.
   * @defaultValue 100
   */
  interval?: number;
  /**
   * The radius for the animation spread effect.
   */
  radius?: number;
  /**
   * The number of rows in the grid.
   * @defaultValue 5
   */
  rowCount?: number;
}

const sizeDefaults = {
  icon: 3,
  lg: 5,
  md: 5,
  sm: 5,
  xl: 5,
};

function useGrid(
  size: VariantProps<typeof AgentAudioVisualizerGridVariants>["size"] = "md",
  columnCount = sizeDefaults[size as keyof typeof sizeDefaults],
  rowCount = sizeDefaults[size as keyof typeof sizeDefaults]
) {
  return useMemo(() => {
    const _columnCount = columnCount;
    const _rowCount = rowCount ?? columnCount;
    const items = new Array(_columnCount * _rowCount).fill(0).map((_, idx) => idx);

    return { columnCount: _columnCount, items, rowCount: _rowCount };
  }, [columnCount, rowCount]);
}

interface GridCellProps {
  children?: ReactNode;
  columnCount: number;
  highlightedCoordinate: Coordinate;
  index: number;
  interval: number;
  rowCount: number;
  state: AgentState;
  volumeBands: number[];
}

const GridCell = memo(function GridCell({
  index,
  state,
  interval,
  rowCount,
  columnCount,
  volumeBands,
  highlightedCoordinate,
  children,
}: GridCellProps) {
  if (state === "speaking") {
    const y = Math.floor(index / columnCount);
    const rowMidPoint = Math.floor(rowCount / 2);
    const volumeChunks = 1 / (rowMidPoint + 1);
    const distanceToMid = Math.abs(rowMidPoint - y);
    const threshold = distanceToMid * volumeChunks;
    const isHighlighted = (volumeBands[index % columnCount] ?? 0) >= threshold;

    return cloneSingleChild(children, {
      "data-lk-highlighted": isHighlighted,
      "data-lk-index": index,
    });
  }

  const isHighlighted =
    highlightedCoordinate.x === index % columnCount &&
    highlightedCoordinate.y === Math.floor(index / columnCount);

  const transitionDurationInSeconds = interval / (isHighlighted ? 1000 : 100);

  return cloneSingleChild(children, {
    "data-lk-highlighted": isHighlighted,
    "data-lk-index": index,
    style: {
      transitionDuration: `${transitionDurationInSeconds}s`,
    },
  });
});

/**
 * Props for the AgentAudioVisualizerGrid component.
 */
export type AgentAudioVisualizerGridProps = GridOptions & {
  /**
   * The size of the visualizer.
   * @defaultValue 'md'
   */
  size?: "icon" | "sm" | "md" | "lg" | "xl";
  /**
   * The current state of the agent. Determines the animation pattern.
   * @defaultValue 'connecting'
   */
  state?: AgentState;
  /**
   * The color of the grid cells in hexidecimal format.
   */
  color?: `#${string}`;
  /**
   * The audio track to visualize. Can be a local/remote audio track or a track reference.
   */
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder;
  /**
   * Volume values (0-1) to use instead of the values computed from the audioTrack.
   * The volumeBands.length should match columnCount.
   */
  volumeBands?: number[];
  /**
   * Additional CSS class names to apply to the container.
   */
  className?: string;
  /**
   * Custom element to render as grid cells. Each child receives data-lk-index
   * and data-lk-highlighted props.
   */
  children?: ReactNode;
} & VariantProps<typeof AgentAudioVisualizerGridVariants>;

/**
 * A grid-style audio visualizer that responds to agent state and audio levels.
 * Displays an animated grid of cells that react to the current agent state
 * and audio volume when speaking.
 *
 * @extends ComponentProps<'div'>
 *
 * @example
 * ```tsx
 * <AgentAudioVisualizerGrid
 *   size="md"
 *   state="speaking"
 *   rowCount={5}
 *   columnCount={5}
 *   audioTrack={agentAudioTrack}
 * />
 * ```
 */
export function AgentAudioVisualizerGrid({
  size = "md",
  state = "connecting",
  radius,
  color,
  rowCount: _rowCount = 5,
  columnCount: _columnCount = 5,
  interval = 100,
  className,
  children,
  audioTrack,
  volumeBands,
  style,
  ...props
}: AgentAudioVisualizerGridProps & ComponentProps<"div">) {
  const { columnCount, rowCount, items } = useGrid(size, _columnCount, _rowCount);
  const highlightedCoordinate = useAgentAudioVisualizerGridAnimator(
    state,
    rowCount,
    columnCount,
    interval,
    radius
  );
  const multibandVolume = useMultibandTrackVolume(audioTrack, {
    bands: columnCount,
    hiPass: 200,
    loPass: 100,
  });
  const resolvedVolumeBands = volumeBands
    ? normalizeVolumeBands(volumeBands, columnCount)
    : multibandVolume;

  if (children && Array.isArray(children)) {
    throw new Error("AgentAudioVisualizerGrid children must be a single element.");
  }

  return (
    <div
      className={cn(AgentAudioVisualizerGridVariants({ size }), className)}
      data-lk-state={state}
      style={
        { ...style, color, gridTemplateColumns: `repeat(${columnCount}, 1fr)` } as CSSProperties
      }
      {...props}
    >
      {items.map((idx) => (
        <GridCell
          columnCount={columnCount}
          highlightedCoordinate={highlightedCoordinate}
          index={idx}
          interval={interval}
          key={idx}
          rowCount={rowCount}
          state={state}
          volumeBands={resolvedVolumeBands}
        >
          {children ?? <div className={AgentAudioVisualizerGridCellVariants({ size })} />}
        </GridCell>
      ))}
    </div>
  );
}
