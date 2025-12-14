declare module 'adm-zip' {
  export default class AdmZip {
    constructor(input?: string | Buffer);
    getEntries(): Array<{
      entryName: string;
      isDirectory: boolean;
      getData(): Buffer;
    }>;
  }
}
