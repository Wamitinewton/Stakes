import type { ScoreHistory } from '@stakes/contracts';

export function sparklinePoints(points: ScoreHistory['points'], width = 240, height = 48): string {
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index * width) / (points.length - 1);
      const y = height - (point.score / 100) * height;
      return `${x},${y}`;
    })
    .join(' ');
}

export function historyChange(points: ScoreHistory['points']): number {
  if (points.length < 2) return 0;
  return points.at(-1)!.score - points[0]!.score;
}
