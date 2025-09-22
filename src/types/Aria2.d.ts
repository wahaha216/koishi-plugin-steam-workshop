export type Aria2Respond<T = string[][]> = {
  id: string;
  jsonrpc: "2.0";
  result: T;
};

export type Aria2Files = {
  completedLength: string;
  index: string;
  length: string;
  path: string;
  selected: "true" | "false";
  uris: { status: "waiting" | "used"; uri: string }[];
};

export type Aria2TellStatus = {
  completedLength: string;
  connections: string;
  dir: string;
  downloadSpeed: string;
  files: Aria2Files[];
  gid: string;
  numPieces: string;
  pieceLength: string;
  status: "active" | "waiting" | "paused" | "error" | "complete" | "removed";
  totalLength: string;
  uploadLength: string;
  uploadSpeed: string;
  infoHash?: string;
  numSeeders?: string;
  seeder?: "true" | "false";
  errorCode: string;
  errorMessage: string;
};

export type Aria2Params = (
  | string
  | string[]
  | {
      //下载根目录
      dir?: string;
      //目标文件名
      out?: string;
      //referer 用来绕开部分防盗链机制 星号表示使用url作为referer
      referer?: "*" | string;
      header?: string[];
    }
)[];

export type RpcBody = {
  id: string;
  jsonrpc: "2.0";
  method: "system.multicall" | "aria2.addUri" | "aria2.tellStatus";
  params: [Object[]];
};
