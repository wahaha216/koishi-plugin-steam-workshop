import { HTTP, Logger, Session } from "koishi";
import { WorkshopFileInfo, WorkshopInfo } from "../types";
import { formatFileName, requestWithRetry } from "../utils";
import { WORKSHOP_API } from "../utils/const";
import { sizeFormat, timestampToDate } from "../utils/sizeFormat";
import { Config } from "..";
import { RpcBody } from "../types/Aria2";
import { RequestFailedError } from "../error/requestFailed.error";

export class SteamWorkshop {
  private session: Session;
  private http: HTTP;
  private logger: Logger;
  private config: Config;

  private title: string;
  private workshopInfo: WorkshopInfo[];
  /**
   * 单文件
   */
  private singleFile: boolean;
  private fileInfos: WorkshopFileInfo[];

  constructor(session: Session, http: HTTP, logger: Logger, config: Config) {
    this.session = session;
    this.http = http;
    this.logger = logger;
    this.config = config;
  }

  /**
   * 解析steam创意工坊链接
   * @param url steam创意工坊链接
   */
  public async analyzeUrl(url: string): Promise<void> {
    const u = new URL(url);
    const workshopId = u.searchParams.get("id");

    this.workshopInfo = await requestWithRetry<WorkshopInfo[]>(
      this.http,
      this.logger,
      this.config.requestRetries,
      WORKSHOP_API,
      "POST",
      { data: `[${workshopId}]`, responseType: "json" }
    );

    if (this.workshopInfo.length === 0) {
      throw new RequestFailedError(this.session.text(".request_fail"));
    }

    const firstInfo = this.workshopInfo[0];
    this.singleFile = firstInfo.num_children === 0;
    this.title = firstInfo.title;

    // 合集、有依赖文件
    if (!this.singleFile) {
      const workIds = firstInfo.children.map((item) => item.publishedfileid);
      if (workIds.length <= 50) {
        const res = await requestWithRetry<WorkshopInfo[]>(
          this.http,
          this.logger,
          this.config.requestRetries,
          WORKSHOP_API,
          "POST",
          { data: `[${workIds.join(",")}]`, responseType: "json" }
        );
        this.workshopInfo.push(...res);
      } else {
        // 按50个切割，分别进行请求
        do {
          const ids = workIds.slice(0, 50).join(",");
          const res = await requestWithRetry<WorkshopInfo[]>(
            this.http,
            this.logger,
            this.config.requestRetries,
            WORKSHOP_API,
            "POST",
            { data: `[${ids}]`, responseType: "json" }
          );
          this.workshopInfo.push(...res);
          workIds.splice(0, 50);
        } while (workIds.length);
      }
    }

    const infos: WorkshopFileInfo[] = [];
    this.workshopInfo.forEach((item) => {
      infos.push({
        title: item.title,
        releaseTimestamp: item.time_created,
        releaseTime: timestampToDate(item.time_created * 1000),
        updateTimestamp: item.time_updated,
        updateTime: timestampToDate(item.time_updated * 1000),
        fileSize: item.file_size,
        formatFileSize: sizeFormat(item.file_size),
        game: item.app_name,
        description: item.file_description,
        imageUrl: item.preview_url,
        fileUrl: item.file_url,
        fileName: formatFileName(this.logger, item, this.session),
      });
    });
    this.fileInfos = infos;
  }

  /**
   * 生成批量下载的请求体
   * @returns 批量下载的请求体
   */
  public buildRpcDownloadBody(): RpcBody {
    const multiParams = this.fileInfos.map((item) => {
      const params = [
        `token:${this.config.rpcSecret}`,
        [item.fileUrl],
        { dir: this.config.rpcDir, out: item.fileName },
      ];
      if (!this.config.rpcSecret) params.shift();
      return { methodName: "aria2.addUri", params };
    });
    return {
      id: new Date().getTime().toString(),
      jsonrpc: "2.0",
      method: "system.multicall",
      params: [multiParams],
    };
  }

  /**
   * 生成获取下载状态的请求体
   * @param guids aria2返回的下载任务guid列表
   * @returns 获取下载状态的请求体
   */
  public buildRpcStatusBody(guids: string[]): RpcBody {
    return {
      id: new Date().getTime().toString(),
      jsonrpc: "2.0",
      method: "system.multicall",
      params: [
        guids.map((guid) => {
          const params = [`token:${this.config.rpcSecret}`, guid];
          if (!this.config.rpcSecret) params.shift();
          return { methodName: "aria2.tellStatus", params };
        }),
      ],
    };
  }

  /**
   * 获取是否为单文件
   * @returns 是否为单文件
   */
  public getSingleFile(): boolean {
    return this.singleFile;
  }

  public getWorkshopInfo() {
    return this.workshopInfo;
  }

  public getFileInfos() {
    return this.fileInfos;
  }

  public getTitle() {
    return this.title;
  }
}
