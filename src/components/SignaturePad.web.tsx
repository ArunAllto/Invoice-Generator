/**
 * Web implementation of `SignaturePad` — see the native file for why this exists.
 *
 * Draws on a DOM canvas with pointer events, which covers mouse, trackpad and touch from one
 * set of handlers. Strokes are kept as an array of point-arrays rather than only painted, so
 * undo can repaint the remaining strokes — the same behaviour §7.2 asks for on the device.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette, spacing } from '../theme';
import { Button, Caption } from './ui';
import { t } from '../strings';

export interface SignaturePadProps {
  onDone: (dataUri: string) => void;
  onEmpty: () => void;
}

type Point = { x: number; y: number };

const WIDTH = 600;
const HEIGHT = 240;

export function SignaturePad({ onDone, onEmpty }: SignaturePadProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#000000';
    context.lineWidth = 2.5;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      context.beginPath();
      context.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      // A single tap should still leave a visible dot.
      if (stroke.length === 1) context.lineTo(stroke[0]!.x + 0.1, stroke[0]!.y);
      context.stroke();
    }
    setHasInk(strokesRef.current.some((stroke) => stroke.length > 0));
  }, []);

  useEffect(repaint, [repaint]);

  const pointFrom = (event: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    // The canvas is drawn at a fixed resolution but laid out fluidly, so pointer
    // coordinates have to be scaled into canvas space or the ink lands off the cursor.
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  return (
    <View style={styles.container}>
      <Caption>Draw your signature with the mouse or your finger.</Caption>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{
          width: '100%',
          height: HEIGHT,
          border: `1px solid ${palette.border}`,
          borderRadius: 8,
          touchAction: 'none',
          cursor: 'crosshair',
          background: '#FFFFFF',
        }}
        onPointerDown={(event: React.PointerEvent) => {
          drawingRef.current = true;
          strokesRef.current.push([pointFrom(event)]);
          repaint();
        }}
        onPointerMove={(event: React.PointerEvent) => {
          if (!drawingRef.current) return;
          strokesRef.current[strokesRef.current.length - 1]?.push(pointFrom(event));
          repaint();
        }}
        onPointerUp={() => {
          drawingRef.current = false;
        }}
        onPointerLeave={() => {
          drawingRef.current = false;
        }}
      />
      <View style={styles.row}>
        <Button
          label={t('undo')}
          variant="ghost"
          onPress={() => {
            strokesRef.current.pop();
            repaint();
          }}
        />
        <Button
          label={t('signatureClear')}
          variant="secondary"
          onPress={() => {
            strokesRef.current = [];
            repaint();
          }}
        />
        <Button
          label={t('done')}
          onPress={() => {
            if (!hasInk) {
              onEmpty();
              return;
            }
            const dataUri = canvasRef.current?.toDataURL('image/png');
            if (dataUri) onDone(dataUri);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
