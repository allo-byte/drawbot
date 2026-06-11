export type Point = {
  x: number;
  y: number;
};

export type Stroke = {
  points: Point[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
};