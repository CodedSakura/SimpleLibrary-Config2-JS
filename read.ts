class ByteReader {
  private index: number;
  readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    this.index = 0;
  }

  debug() {
    console.info(
      ...Array.from(this.data).slice(Math.max(this.index-4, 0), Math.min(this.index+8, this.data.length-1))
        .reduce((s, v, i) =>
          s.concat(i === 4 ? "_" : "", ("0" + v.toString(16).toUpperCase()).slice(-2)), []
        ).filter(v => v)
    );
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
  static bitsToNumber(bits: (0|1)[]): number {
    return bits.reduce((s, v, i, {length}) => s | v << (length - i - 1), 0);
  }

  nextInteger(): number {
    return ByteReader.bytesToNumber(this.nextBytes(4));
  }
  nextLong(): number {
    return ByteReader.bytesToNumber(this.nextBytes(8));
  }
  nextBoolean(): boolean {
    return this.nextByte() === 1;
  }
  nextFloat(): number {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    const bytes = this.nextBytes(4);
    console.log(bytes);
    bytes.forEach((v, i) => view.setUint8(i, v));
    return view.getFloat32(0);
  }
  nextModifiedUTF8String(): string {
    const length = ByteReader.bytesToNumber(this.nextBytes(2));
    return String.fromCharCode(...this.nextBytes(length));
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
  HugeLong,
  ConfigList,
  Byte,
  Short,
  NumberList,
}

enum NestType {Base, Standard, List}

interface Config2Root {
  version: number
  data: object
}

function readConfig2(data: Uint8Array): Config2Root|Config2Root[] {
  console.log("v7");
  const out: Config2Root[] = [];
  const reader = new ByteReader(data);

  let currentType: ConfigType = ConfigType.None;
  let nesting: NestType[] = [];

  function setData({name = "", data}: { name?: string, data: any }) {
    let current: any = out;
    nesting.forEach((v, i, arr) => {
      switch (v) {
        case NestType.Base:
          current = current[current.length - 1].data;
          break;
        case NestType.Standard:
          if (Array.isArray(current)) current = current[current.length - 1];
          else current = current[""];
          break;
        case NestType.List:
          // console.log("<< A <<", current, arr.slice(i));
          if (i === arr.length - 1 && current[""].data.length === current[""].length - 1) {
            arr.pop();
            break;
          }
          current = current[""].data;
          break;
      }
      // console.log(current, arr.slice(i+1).map(v => NestType[v]));
    });
    console.log("<< B <<", current, nesting);
    if (Array.isArray(current)) current.push(data);
    else current[name] = data;
  }
  function rename(name) {
    let current: any = out;
    nesting.forEach((v, i, arr) => {
      switch (v) {
        case NestType.Base:
          current = current[current.length - 1].data;
          break;
        case NestType.Standard:
          current = current[""];
          break;
        case NestType.List:
          current = current[""].data;
          current = current[current.length - 1];
          break;
      }
    });
    delete Object.assign(current, {[name]: current[""] })[""];
  }

  while (reader.hasNextByte()) {
    switch (currentType) {
      case ConfigType.None: {
        console.log(">> A >>", nesting);
        let type = nesting.pop();
        if (nesting.length === 0) {
          out.push({
            version: ByteReader.bytesToNumber(reader.nextBytes(2)),
            data: {}
          });
          nesting.push(NestType.Base);
        } else {
          reader.debug();
          if (nesting[nesting.length - 1] !== NestType.List)
            rename(reader.nextModifiedUTF8String());
        }
        break;
      }
      case ConfigType.Config:
        setData({data: {}});
        // if (nesting[nesting.length-1] !== NestType.List)
        nesting.push(NestType.Standard);
        break;
      case ConfigType.String:
        setData({
          data: reader.nextModifiedUTF8String(),
          name: reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Integer:
        setData({
          data: reader.nextInteger(),
          name: reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Float:
        setData({
          data: reader.nextFloat(),
          name: reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Boolean:
        setData({
          data: reader.nextBoolean(),
          name: reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Long:
        break;
      case ConfigType.Double:
        break;
      case ConfigType.HugeLong:
        break;
      case ConfigType.ConfigList:
        // reader.debug();
        switch (reader.nextByte()) {
          case 0x00:
            setData({data: {data: [], length: 0, index: 0}});
            break;
          case 0x02:
            setData({data: {data: [], length: -1, index: 0}});
            nesting.push(NestType.List);
            break;
          default:
            reader.debug();
            const length = reader.nextInteger();
            setData({data: {data: new Array(length).fill({}), length: length, index: 0}});
            nesting.push(NestType.List);
            break;
        }
        break;
      case ConfigType.Byte:
        setData({
          data: reader.nextByte(),
          name: reader.nextModifiedUTF8String()
        });
        break;
      case ConfigType.Short:
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
            name: reader.nextModifiedUTF8String()
          });
          break;
        }
        let arr = new Array(arrLength);

        let maxDigits = reader.nextByte();
        const hasNeg = (maxDigits & 0b0100_0000) >> 6;
        const verbatim = (maxDigits & 0b1000_0000) >> 7;
        maxDigits = maxDigits & 0b0011_1111;
        if (maxDigits === 0) {
          arr.fill(0);
          setData({
            data: arr,
            name: reader.nextModifiedUTF8String()
          });
          break;
        }

        if (verbatim) {
          arr = arr.fill(0).map(_ => reader.nextLong());
          setData({
            data: arr,
            name: reader.nextModifiedUTF8String()
          });
          break;
        }

        let bits: (0|1)[] = []
        let sign = 1;
        for (let i = 0; i < arrLength; i++) {
          while (bits.length < maxDigits + hasNeg)
            bits = bits.concat(reader.next8Bits());

          if (hasNeg)
            sign = bits.splice(0, 1)[0] ? -1 : 1;
          arr[i] = sign * ByteReader.bitsToNumber(bits.splice(0, maxDigits));
        }

        setData({
          data: arr,
          name: reader.nextModifiedUTF8String()
        });

        break;
      }
      default:
        console.log(out, (currentType as number).toString(16));
        throw new Error("unknown config type");
    }
    currentType = reader.nextByte();
    console.log(`>>>> ${ConfigType[currentType]}`)
  }

  if (out.length === 1) return out[0];
  return out;
}