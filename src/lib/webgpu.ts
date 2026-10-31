import type { Rgb } from './quantize'

export interface RenderParams {
  viewW: number
  viewH: number
  dpr: number
  scale: number
  tx: number
  ty: number
  selected: number | null
}

export interface WebGPURenderer {
  setImage(
    width: number,
    height: number,
    palette: Rgb[],
    indices: Uint16Array,
    filled: Uint8Array,
  ): void
  setFilled(filled: Uint8Array): void
  paintCell(x: number, y: number): void
  render(params: RenderParams): void
  destroy(): void
}

interface MsdfCharJson {
  id: number
  width: number
  height: number
  xoffset: number
  yoffset: number
  xadvance: number
  x: number
  y: number
}

interface MsdfFontJson {
  pages: string[]
  chars: MsdfCharJson[]
  common: {
    lineHeight: number
    scaleW: number
    scaleH: number
  }
  distanceField?: {
    distanceRange?: number
  }
}

const GRID_FADE_START = 3
const GRID_FADE_END = 7
const NUMBER_FADE_START = 3
const NUMBER_FADE_END = 7

const SHADER_CODE = /* wgsl */ `
struct Uniforms {
  viewport: vec2f,
  translate: vec2f,
  imageSize: vec2f,
  scale: f32,
  gridAlpha: f32,
  numAlpha: f32,
  pxRange: f32,
  selected: i32,
  gridWidth: f32,
};

struct DigitGlyph {
  texOffset: vec2f,
  texExtent: vec2f,
  size: vec2f,
  offset: vec2f,
  advance: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var fontTex: texture_2d<f32>;
@group(0) @binding(2) var fontSampler: sampler;
@group(0) @binding(3) var<storage, read> digits: array<DigitGlyph>;
@group(0) @binding(4) var<storage, read> palette: array<vec4f>;
@group(0) @binding(5) var indicesTex: texture_2d<u32>;
@group(0) @binding(6) var filledTex: texture_2d<u32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

const QUAD_POS = array<vec2f, 6>(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 0.0),
  vec2f(1.0, 1.0),
);

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corner = QUAD_POS[vertexIndex];
  let imgPos = corner * u.imageSize;
  let screenPos = imgPos * u.scale + u.translate;
  let ndc = vec2f(
    (screenPos.x / u.viewport.x) * 2.0 - 1.0,
    1.0 - (screenPos.y / u.viewport.y) * 2.0,
  );

  var out: VertexOutput;
  out.position = vec4f(ndc, 0.0, 1.0);
  out.uv = imgPos;
  return out;
}

fn sampleMsdf(texcoord: vec2f) -> f32 {
  let c = textureSampleLevel(fontTex, fontSampler, texcoord, 0.0);
  return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

const UNFILLED_COLOR = vec3f(232.0 / 255.0, 232.0 / 255.0, 232.0 / 255.0);
const HIGHLIGHT_COLOR = vec3f(207.0 / 255.0, 207.0 / 255.0, 207.0 / 255.0);
const GRID_COLOR = vec3f(200.0 / 255.0, 200.0 / 255.0, 200.0 / 255.0);

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let dims = vec2i(u.imageSize);
  let cell = clamp(vec2i(floor(in.uv)), vec2i(0), dims - vec2i(1));

  let idx = i32(textureLoad(indicesTex, cell, 0).r);
  let isFilled = textureLoad(filledTex, cell, 0).r != 0u;

  var color = UNFILLED_COLOR;
  if (isFilled) {
    color = palette[idx].rgb;
  } else if (idx == u.selected) {
    color = HIGHLIGHT_COLOR;
  }

  let local = fract(in.uv);

  if (!isFilled && u.numAlpha > 0.0) {
    var d0 = 0u;
    var d1 = 0u;
    var d2 = 0u;
    var count = 1u;
    let n = u32(max(idx, 0));
    if (n >= 100u) {
      d0 = n / 100u;
      d1 = (n / 10u) % 10u;
      d2 = n % 10u;
      count = 3u;
    } else if (n >= 10u) {
      d0 = n / 10u;
      d1 = n % 10u;
      count = 2u;
    } else {
      d0 = n;
      count = 1u;
    }

    let g0 = digits[d0];
    let g1 = digits[d1];
    let g2 = digits[d2];

    var totalAdvance = g0.advance;
    var minY = g0.offset.y;
    var maxY = g0.offset.y + g0.size.y;
    if (count >= 2u) {
      totalAdvance += g1.advance;
      minY = min(minY, g1.offset.y);
      maxY = max(maxY, g1.offset.y + g1.size.y);
    }
    if (count == 3u) {
      totalAdvance += g2.advance;
      minY = min(minY, g2.offset.y);
      maxY = max(maxY, g2.offset.y + g2.size.y);
    }

    let baseScale = 0.40 / 36.0;
    let widthScale = 0.62 / max(totalAdvance, 1.0);
    let textScale = min(baseScale, widthScale);

    let startX = 0.5 - (totalAdvance * textScale) * 0.5;
    let startY = 0.5 - ((minY + maxY) * 0.5) * textScale;

    let fontPoint = vec2f(
      (local.x - startX) / textScale,
      (local.y - startY) / textScale,
    );

    var penX = 0.0;
    var hit = false;
    var atlasUV = vec2f(0.0);
    var glyphTexExtent = vec2f(1.0);
    var glyphSize = vec2f(1.0);

    for (var i = 0u; i < 3u; i++) {
      if (i >= count) {
        break;
      }
      var g = g0;
      if (i == 1u) {
        g = g1;
      } else if (i == 2u) {
        g = g2;
      }

      let gx0 = penX + g.offset.x;
      let gy0 = g.offset.y;
      let gx1 = gx0 + g.size.x;
      let gy1 = gy0 + g.size.y;

      if (fontPoint.x >= gx0 && fontPoint.x <= gx1 && fontPoint.y >= gy0 && fontPoint.y <= gy1) {
        let norm = (fontPoint - vec2f(gx0, gy0)) / g.size;
        atlasUV = g.texOffset + norm * g.texExtent;
        glyphTexExtent = g.texExtent;
        glyphSize = g.size;
        hit = true;
        break;
      }
      penX += g.advance;
    }

    if (hit) {
      let sz = vec2f(textureDimensions(fontTex, 0));
      let texelsPerCell = (glyphTexExtent * sz) / (glyphSize * textScale);
      let screenPxPerTexel = u.scale / texelsPerCell;
      let toPixels = u.pxRange * min(screenPxPerTexel.x, screenPxPerTexel.y);
      let sigDist = sampleMsdf(atlasUV) - 0.5;
      let pxDist = sigDist * toPixels;
      let alpha = smoothstep(-0.5, 0.5, pxDist) * u.numAlpha;
      color = mix(color, vec3f(0.1), alpha);
    }
  }

  if (!isFilled && u.gridAlpha > 0.0) {
    let distCells = min(local, 1.0 - local);
    let distPx = min(distCells.x, distCells.y) * u.scale;
    let halfW = u.gridWidth * 0.5;
    let lineMask = 1.0 - smoothstep(halfW - 0.5, halfW + 0.5, distPx);
    color = mix(color, GRID_COLOR, lineMask * u.gridAlpha);
  }

  return vec4f(color, 1.0);
}
`

export async function createRenderer(
  canvas: HTMLCanvasElement,
  fontJsonUrl = '/font/ya-hei-ascii-msdf.json',
): Promise<WebGPURenderer> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser.')
  }

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    throw new Error('Failed to request WebGPU adapter.')
  }

  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new Error('Failed to acquire WebGPU canvas context.')
  }

  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  })

  // Load MSDF font JSON and texture atlas (following webgpu-samples/textRenderingMsdf)
  const fontRes = await fetch(fontJsonUrl)
  const fontJson: MsdfFontJson = await fontRes.json()
  const lastSlash = fontJsonUrl.lastIndexOf('/')
  const baseUrl = lastSlash !== -1 ? fontJsonUrl.substring(0, lastSlash + 1) : ''
  const pageUrl = baseUrl + fontJson.pages[0]

  const imgRes = await fetch(pageUrl)
  const bitmap = await createImageBitmap(await imgRes.blob())

  const fontTex = device.createTexture({
    label: 'MSDF font atlas',
    size: [bitmap.width, bitmap.height, 1],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture: fontTex },
    [bitmap.width, bitmap.height],
  )

  const fontSampler = device.createSampler({
    label: 'MSDF sampler',
    minFilter: 'linear',
    magFilter: 'linear',
  })

  // Build digit glyph buffer for digits '0' (48) through '9' (57)
  // Each DigitGlyph is 12 floats (48 bytes)
  const digitsData = new Float32Array(10 * 12)
  const uScale = 1 / fontJson.common.scaleW
  const vScale = 1 / fontJson.common.scaleH
  const charMap = new Map<number, MsdfCharJson>()
  for (const ch of fontJson.chars) {
    charMap.set(ch.id, ch)
  }

  for (let d = 0; d < 10; d++) {
    const ch = charMap.get(48 + d) ?? fontJson.chars[0]
    const base = d * 12
    digitsData[base + 0] = ch.x * uScale
    digitsData[base + 1] = ch.y * vScale
    digitsData[base + 2] = ch.width * uScale
    digitsData[base + 3] = ch.height * vScale
    digitsData[base + 4] = ch.width
    digitsData[base + 5] = ch.height
    digitsData[base + 6] = ch.xoffset
    digitsData[base + 7] = ch.yoffset
    digitsData[base + 8] = ch.xadvance
  }

  const digitsBuf = device.createBuffer({
    label: 'MSDF digits buffer',
    size: digitsData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(digitsBuf, 0, digitsData)

  const uniformBuf = device.createBuffer({
    label: 'Grid uniforms',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const bindGroupLayout = device.createBindGroupLayout({
    label: 'Grid bind group layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
    ],
  })

  const shaderModule = device.createShaderModule({
    label: 'Pixel canvas WebGPU shader',
    code: SHADER_CODE,
  })

  const pipeline = await device.createRenderPipelineAsync({
    label: 'Pixel canvas pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  })

  let imgW = 0
  let imgH = 0
  let paletteBuf: GPUBuffer | null = null
  let indicesTex: GPUTexture | null = null
  let filledTex: GPUTexture | null = null
  let bindGroup: GPUBindGroup | null = null
  let destroyed = false

  const pxRange = fontJson.distanceField?.distanceRange ?? 4
  const singleFilledByte = new Uint8Array([1])
  const uniformScratch = new ArrayBuffer(48)
  const uniformF32 = new Float32Array(uniformScratch)
  const uniformI32 = new Int32Array(uniformScratch)

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  function rebuildBindGroup() {
    if (!paletteBuf || !indicesTex || !filledTex) return
    bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: fontTex.createView() },
        { binding: 2, resource: fontSampler },
        { binding: 3, resource: { buffer: digitsBuf } },
        { binding: 4, resource: { buffer: paletteBuf } },
        { binding: 5, resource: indicesTex.createView() },
        { binding: 6, resource: filledTex.createView() },
      ],
    })
  }

  return {
    setImage(width, height, palette, indices, filled) {
      if (destroyed) return
      imgW = width
      imgH = height

      paletteBuf?.destroy()
      indicesTex?.destroy()
      filledTex?.destroy()

      const palCount = Math.max(1, palette.length)
      const palArray = new Float32Array(palCount * 4)
      for (let i = 0; i < palette.length; i++) {
        palArray[i * 4 + 0] = palette[i].r / 255
        palArray[i * 4 + 1] = palette[i].g / 255
        palArray[i * 4 + 2] = palette[i].b / 255
        palArray[i * 4 + 3] = 1
      }

      paletteBuf = device.createBuffer({
        label: 'Palette storage buffer',
        size: palArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(paletteBuf, 0, palArray)

      indicesTex = device.createTexture({
        label: 'Cell indices texture',
        size: [width, height, 1],
        format: 'r16uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      device.queue.writeTexture(
        { texture: indicesTex },
        indices.buffer,
        { offset: indices.byteOffset, bytesPerRow: width * 2, rowsPerImage: height },
        [width, height, 1],
      )

      filledTex = device.createTexture({
        label: 'Cell filled texture',
        size: [width, height, 1],
        format: 'r8uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      device.queue.writeTexture(
        { texture: filledTex },
        filled.buffer,
        { offset: filled.byteOffset, bytesPerRow: width, rowsPerImage: height },
        [width, height, 1],
      )

      rebuildBindGroup()
    },

    setFilled(filled) {
      if (destroyed || !filledTex || imgW === 0 || imgH === 0) return
      device.queue.writeTexture(
        { texture: filledTex },
        filled.buffer,
        { offset: filled.byteOffset, bytesPerRow: imgW, rowsPerImage: imgH },
        [imgW, imgH, 1],
      )
    },

    paintCell(x, y) {
      if (destroyed || !filledTex || x < 0 || x >= imgW || y < 0 || y >= imgH) return
      device.queue.writeTexture(
        { texture: filledTex, origin: [x, y, 0] },
        singleFilledByte,
        { bytesPerRow: 1, rowsPerImage: 1 },
        [1, 1, 1],
      )
    },

    render({ viewW, viewH, dpr, scale, tx, ty, selected }) {
      if (destroyed) return
      const W = canvas.width
      const H = canvas.height
      if (W === 0 || H === 0 || viewW === 0 || viewH === 0) return

      const gridAlpha = clamp((scale - GRID_FADE_START) / (GRID_FADE_END - GRID_FADE_START), 0, 1)
      const numAlpha = clamp((scale - NUMBER_FADE_START) / (NUMBER_FADE_END - NUMBER_FADE_START), 0, 1)

      uniformF32[0] = W
      uniformF32[1] = H
      uniformF32[2] = tx * dpr
      uniformF32[3] = ty * dpr
      uniformF32[4] = imgW
      uniformF32[5] = imgH
      uniformF32[6] = scale * dpr
      uniformF32[7] = gridAlpha
      uniformF32[8] = numAlpha
      uniformF32[9] = pxRange
      uniformI32[10] = selected ?? -1
      uniformF32[11] = Math.max(1, Math.round(dpr))

      device.queue.writeBuffer(uniformBuf, 0, uniformScratch)

      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 1, g: 1, b: 1, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })

      if (bindGroup && imgW > 0 && imgH > 0) {
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(6)
      }

      pass.end()
      device.queue.submit([encoder.finish()])
    },

    destroy() {
      destroyed = true
      paletteBuf?.destroy()
      indicesTex?.destroy()
      filledTex?.destroy()
      digitsBuf.destroy()
      uniformBuf.destroy()
      fontTex.destroy()
      device.destroy()
    },
  }
}
