/// Image rotation for EXIF orientation correction.
///
/// Uses tile-based processing for cache efficiency on 90°/270° rotations.
use wasm_bindgen::prelude::*;

const TILE_SIZE: usize = 32;
const BYTES_PER_PIXEL: usize = 4;

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum Rotation {
    #[default]
    None = 0,
    Cw90 = 1,
    Cw180 = 2,
    Cw270 = 3,
}

impl Rotation {
    /// Returns (new_width, new_height) after rotation.
    #[inline]
    pub fn output_dimensions(self, width: usize, height: usize) -> (usize, usize) {
        match self {
            Rotation::None | Rotation::Cw180 => (width, height),
            Rotation::Cw90 | Rotation::Cw270 => (height, width),
        }
    }

    /// Returns true if rotation swaps width and height.
    #[inline]
    pub fn swaps_dimensions(self) -> bool {
        matches!(self, Rotation::Cw90 | Rotation::Cw270)
    }
}

/// Rotate 90° clockwise using tile-based approach for cache efficiency.
/// dst must be sized for (height × width × 4) bytes.
pub fn rotate_90_cw(src: &[u8], dst: &mut [u8], width: usize, height: usize) {
    let new_width = height;

    for tile_y in (0..height).step_by(TILE_SIZE) {
        for tile_x in (0..width).step_by(TILE_SIZE) {
            let tile_w = TILE_SIZE.min(width - tile_x);
            let tile_h = TILE_SIZE.min(height - tile_y);

            for dy in 0..tile_h {
                for dx in 0..tile_w {
                    let src_x = tile_x + dx;
                    let src_y = tile_y + dy;

                    // 90° CW: (x, y) → (height - 1 - y, x)
                    let dst_x = new_width - 1 - src_y;
                    let dst_y = src_x;

                    let src_idx = (src_y * width + src_x) * BYTES_PER_PIXEL;
                    let dst_idx = (dst_y * new_width + dst_x) * BYTES_PER_PIXEL;

                    dst[dst_idx..dst_idx + BYTES_PER_PIXEL]
                        .copy_from_slice(&src[src_idx..src_idx + BYTES_PER_PIXEL]);
                }
            }
        }
    }
}

/// Rotate 270° clockwise (= 90° counter-clockwise) using tile-based approach.
/// dst must be sized for (height × width × 4) bytes.
pub fn rotate_270_cw(src: &[u8], dst: &mut [u8], width: usize, height: usize) {
    let new_width = height;
    let new_height = width;

    for tile_y in (0..height).step_by(TILE_SIZE) {
        for tile_x in (0..width).step_by(TILE_SIZE) {
            let tile_w = TILE_SIZE.min(width - tile_x);
            let tile_h = TILE_SIZE.min(height - tile_y);

            for dy in 0..tile_h {
                for dx in 0..tile_w {
                    let src_x = tile_x + dx;
                    let src_y = tile_y + dy;

                    // 270° CW (= 90° CCW): (x, y) → (y, width - 1 - x)
                    let dst_x = src_y;
                    let dst_y = new_height - 1 - src_x;

                    let src_idx = (src_y * width + src_x) * BYTES_PER_PIXEL;
                    let dst_idx = (dst_y * new_width + dst_x) * BYTES_PER_PIXEL;

                    dst[dst_idx..dst_idx + BYTES_PER_PIXEL]
                        .copy_from_slice(&src[src_idx..src_idx + BYTES_PER_PIXEL]);
                }
            }
        }
    }
}

/// Rotate 180° into a separate buffer (for consistency with other rotations).
pub fn rotate_180(src: &[u8], dst: &mut [u8], width: usize, height: usize) {
    let total_pixels = width * height;
    for i in 0..total_pixels {
        let j = total_pixels - 1 - i;
        let src_off = i * BYTES_PER_PIXEL;
        let dst_off = j * BYTES_PER_PIXEL;
        dst[dst_off..dst_off + BYTES_PER_PIXEL]
            .copy_from_slice(&src[src_off..src_off + BYTES_PER_PIXEL]);
    }
}

/// Apply rotation from src to dst. For Rotation::None, copies src to dst.
/// For 90°/270°, dst must be sized for swapped dimensions.
pub fn rotate(src: &[u8], dst: &mut [u8], width: usize, height: usize, rotation: Rotation) {
    match rotation {
        Rotation::None => {
            dst[..src.len()].copy_from_slice(src);
        }
        Rotation::Cw90 => rotate_90_cw(src, dst, width, height),
        Rotation::Cw180 => rotate_180(src, dst, width, height),
        Rotation::Cw270 => rotate_270_cw(src, dst, width, height),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rotation_dimensions() {
        assert_eq!(Rotation::None.output_dimensions(100, 50), (100, 50));
        assert_eq!(Rotation::Cw90.output_dimensions(100, 50), (50, 100));
        assert_eq!(Rotation::Cw180.output_dimensions(100, 50), (100, 50));
        assert_eq!(Rotation::Cw270.output_dimensions(100, 50), (50, 100));
    }

    #[test]
    fn test_rotate_90_cw_2x2() {
        // 2x2 image:
        // [R][G]    →  [B][R]
        // [B][W]       [W][G]
        let src = [
            255, 0, 0, 255, // R
            0, 255, 0, 255, // G
            0, 0, 255, 255, // B
            255, 255, 255, 255, // W
        ];
        let mut dst = [0u8; 16];
        rotate_90_cw(&src, &mut dst, 2, 2);

        let expected = [
            0, 0, 255, 255, // B
            255, 0, 0, 255, // R
            255, 255, 255, 255, // W
            0, 255, 0, 255, // G
        ];
        assert_eq!(dst, expected);
    }

    #[test]
    fn test_rotate_180_2x2() {
        let src = [
            255, 0, 0, 255, // R
            0, 255, 0, 255, // G
            0, 0, 255, 255, // B
            255, 255, 255, 255, // W
        ];
        let mut dst = [0u8; 16];
        rotate_180(&src, &mut dst, 2, 2);

        let expected = [
            255, 255, 255, 255, // W
            0, 0, 255, 255, // B
            0, 255, 0, 255, // G
            255, 0, 0, 255, // R
        ];
        assert_eq!(dst, expected);
    }
}
