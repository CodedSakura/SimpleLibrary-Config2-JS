class ByteReader {
  private index: number;
  readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    this.index = 0;
  }

  nextByte(): number {
    return this.data[this.index++];
  }
  nextBytes(count: number): number[] {
    let out = [];
    for (let i = 0; i < count; i++) out.push(this.nextByte());
    return out;
  }

  next8Bits(): (0|1)[] {
    const byte = this.nextByte();
    let out = [];
    let i = 8;
    while (--i >= 0) out.push((byte & (1 << i)) >> i);
    return out;
  }

  hasNextByte(): boolean {
    return this.index < this.data.length;
  }

  static bytesToNumber(bytes: number[]): number {
    return bytes.reduce((s, v, i, {length}) => s | v << (length - i - 1 << 3), 0);
  }
  static bytesToBigInt(bytes: number[]): bigint {
    return bytes.reduce((s, v, i, {length}) => s | BigInt(v) << BigInt(length - i - 1 << 3), 0n);
  }
  static bitsToNumber(bits: (0|1)[]): number {
    return bits.reduce((s, v, i, {length}) => s | v << (length - i - 1), 0);
  }
  static bitsToBigInt(bits: (0|1)[]): bigint {
    return bits.reduce((s, v, i, {length}) => s | BigInt(v) << BigInt(length - i - 1), 0n);
  }

  nextShort(): number {
    return ByteReader.bytesToNumber(this.nextBytes(2));
  }
  nextInteger(): number {
    return ByteReader.bytesToNumber(this.nextBytes(4));
  }
  nextLong(): BigInt {
    return ByteReader.bytesToBigInt(this.nextBytes(8));
  }
  nextBoolean(): boolean {
    return this.nextByte() === 1;
  }
  nextFloat(): number {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    const bytes = this.nextBytes(4);
    bytes.forEach((v, i) => view.setUint8(i, v));
    return view.getFloat32(0, false);
  }
  nextDouble(): number {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    const bytes = this.nextBytes(8);
    bytes.forEach((v, i) => view.setUint8(i, v));
    return view.getFloat64(0, false);
  }
  nextModifiedUTF8String(): string {
    const length = ByteReader.bytesToNumber(this.nextBytes(2));
    return String.fromCharCode(...this.nextBytes(length));
  }
}

class ByteWriter {
  private _data: number[] = [];

  writeByte(v: number) {
    this._data.push(v);
  }
  writeBytes(v: number[]) {
    for (const i of v) this.writeByte(i);
  }

  get data(): Uint8Array {
    return new Uint8Array(this._data);
  }

  static intToByes(v: number, count: number = 4): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.unshift(v >> i * 8 & 255);
    }
    return out;
  }
  static bigintToBytes(v: bigint, count: number = 8): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.unshift(Number(v >> BigInt(i * 8) & 255n));
    }
    return out;
  }

  writeShort(v: number) {
    this.writeBytes(ByteWriter.intToByes(v, 2));
  }
  writeInteger(v: number) {
    this.writeBytes(ByteWriter.intToByes(v, 4));
  }
  writeLong(v: bigint) {
    this.writeBytes(ByteWriter.bigintToBytes(v, 4));
  }
  writeBoolean(v: boolean) {
    this.writeByte(v ? 1 : 0);
  }
  writeFloat(v: number) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, v, false);
    this.writeBytes([...new Int8Array(buf)]);
  }
  writeDouble(v: number) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setFloat64(0, v, false);
    this.writeBytes([...new Int8Array(buf)]);
  }
  writeModifiedUTF8String(v: string) {
    this.writeBytes(ByteWriter.intToByes(v.length, 2));
    for (let i = 0; i < v.length; i++) {
      this.writeByte(v.charCodeAt(i));
    }
  }
}

enum ConfigType {
  None = 0,
  Config,
  String,
  Integer,
  Float,
  Boolean,
  Long,
  Double,
  ConfigList=9,
  Byte,
  Short,
  NumberList,
}

enum NestType {Base, Standard, List}

interface ArrayBase {
  data: any[]
  mode: number
  type: number
  length: number
}

interface Config2Root {
  version: number
  data: object
}

function readConfig2(data: Uint8Array): Config2Root[] {
  const out: Config2Root[] = [];
  const reader = new ByteReader(data);

  let currentType: ConfigType = ConfigType.None;
  let nesting: NestType[] = [];

  function getTop(): any {
    let current: any = out;
    nesting.forEach((v) => {
      switch (v) {
        case NestType.Base:
          current = current[current.length - 1].data;
          break;
        case NestType.Standard:
          if (Array.isArray(current)) current = current[current.length - 1];
          else current = current[""];
          break;
        case NestType.List:
          current = current[""].data;
          break;
      }
    });
    return current;
  }
  function setData({name="", data}: {name?: string, data: any}) {
    let current = getTop();
    if (Array.isArray(current)) current.push(data);
    else current[name] = data;
  }

  function getTopArray(): ArrayBase {
    let current: any = out;
    nesting.forEach((v, i, {length}) => {
      switch (v) {
        case NestType.Base:
          current = current[current.length - 1].data;
          break;
        case NestType.Standard:
          if (Array.isArray(current)) current = current[current.length - 1];
          else current = current[""];
          break;
        case NestType.List:
          current = current[""];
          if (i !== length - 1) current = current.data;
          break;
      }
    });
    return current;
  }
  function rename(name, topArray) {
    let current = getTop();
    if (topArray) current[""] = topArray.data;
    delete Object.assign(current, {[name]: current[""] })[""];
  }

  while (reader.hasNextByte()) {
    let topArray = undefined;
    if (nesting[nesting.length - 1] === NestType.List) {
      topArray = getTopArray();
    }
    const skipName = !!topArray;

    switch (currentType) {
      case ConfigType.None: {
        nesting.pop();
        if (nesting.length === 0) {
          out.push({
            version: ByteReader.bytesToNumber(reader.nextBytes(2)),
            data: {}
          });
          nesting.push(NestType.Base);
        } else {
          if (nesting[nesting.length - 1] === NestType.List) {
            topArray = getTopArray();
            if (topArray.data.length === topArray.length) {
              nesting.pop();
            } else {
              if (topArray.mode === 0x01) {
                currentType = topArray.type;
                continue;
              }
              break;
            }
          }
          rename(reader.nextModifiedUTF8String(), topArray);
        }
        break;
      }
      case ConfigType.Config:
        setData({data: {}});
        nesting.push(NestType.Standard);
        break;
      case ConfigType.String:
        setData({
          data: reader.nextModifiedUTF8String(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Integer:
        setData({
          data: reader.nextInteger(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Float:
        setData({
          data: reader.nextFloat(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Boolean:
        setData({
          data: reader.nextBoolean(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Long:
        setData({
          data: reader.nextLong(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Double:
        setData({
          data: reader.nextDouble(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.ConfigList: {
        const data: Partial<{ data: any[], mode: number, type: number, length: number }> =
          {data: [], mode: reader.nextByte()};
        switch (data.mode) {
          case 0x00:
            data.length = 0;
            setData({data: data});
            break;
          case 0x01:
            data.length = reader.nextInteger();
            data.type = reader.nextByte();
            setData({data: data});
            nesting.push(NestType.List);
            currentType = data.type;
            continue;
          case 0x02:
            data.length = -1;
            setData({data: data});
            nesting.push(NestType.List);
            break;
        }
        break;
      }
      case ConfigType.Byte:
        setData({
          data: reader.nextByte(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Short:
        setData({
          data: reader.nextShort(),
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.NumberList: {
        let size = [reader.nextByte()];
        switch (size[0] & 0b1100_0000) {
          case 0b1100_0000:
            size = size.concat(reader.nextBytes(4));
            break;
          case 0b1000_0000:
            size = size.concat(reader.nextBytes(3));
            break;
          case 0b0100_0000:
            size = size.concat(reader.nextBytes(1));
            break;
        }
        size[0] &= 0b0011_1111;

        const arrLength = ByteReader.bytesToNumber(size)
        if (arrLength === 0) {
          setData({
            data: [],
            name: skipName ? "" : reader.nextModifiedUTF8String()
          });
          break;
        }
        let arr = new Array(arrLength);

        let maxDigits = reader.nextByte();
        const hasNeg = (maxDigits & 0b0100_0000) >> 6;
        const verbatim = (maxDigits & 0b1000_0000) >> 7;
        maxDigits = maxDigits & 0b0011_1111;

        if (verbatim) {
          for (let i = 0; i < arrLength; i++) {
            arr[i] = reader.nextLong();
          }
          setData({
            data: arr,
            name: skipName ? "" : reader.nextModifiedUTF8String()
          });
          break;
        }

        if (maxDigits === 0) {
          arr.fill(0);
          setData({
            data: arr,
            name: skipName ? "" : reader.nextModifiedUTF8String()
          });
          break;
        }

        let bits: (0 | 1)[] = []
        let sign = 1;
        for (let i = 0; i < arrLength; i++) {
          while (bits.length < maxDigits + hasNeg) {
            bits = bits.concat(reader.next8Bits());
          }

          if (hasNeg)
            sign = bits.splice(0, 1)[0] ? -1 : 1;
          if (maxDigits + hasNeg > 53)
            arr[i] = BigInt(sign) * ByteReader.bitsToBigInt(bits.splice(0, maxDigits));
          else
            arr[i] = sign * ByteReader.bitsToNumber(bits.splice(0, maxDigits));
        }

        setData({
          data: arr,
          name: skipName ? "" : reader.nextModifiedUTF8String()
        });

        break;
      }
      default:
        throw new Error(`unknown config type ("${currentType}")`);
    }

    if (topArray && topArray.mode === 0x01 && topArray.type !== ConfigType.Config) {
      if (topArray.data.length !== topArray.length) {
        continue;
      }
      nesting.pop();
      rename(reader.nextModifiedUTF8String(), topArray);
    }
    currentType = reader.nextByte();
  }

  return out;
}

function writeConfig2(input: Config2Root[]): Uint8Array {
  const out: ByteWriter = new ByteWriter();
  for (const i in input) {
    const {version, data} = input[i];
    out.writeShort(version);
    console.log(data);
  }
  return out.data;
}