/**
 * storage.ts — 网站对象存储 SDK（平台预置，请勿修改）
 *
 * 你的网站已接入平台对象存储。所有文件读写通过本模块完成，
 * 凭据由平台注入环境变量，你没有也不应向用户索要任何密钥。
 *
 * 环境变量（平台自动注入，缺失说明存储未供给）：
 *   KIMI_AGENTGW_API_KEY    — 平台网关鉴权 key（仅服务端可用，禁止下发浏览器）
 *   KIMI_AGENTGW_BASE_URL    — AgentGW OSS 入口，**绝对 URL**（平台注入，不会是相对路径）
 *                              dev:  https://agent-gw-dev.dev.kimi.team/coding/v1
 *                              prod: https://agent-gw.kimi.com/coding/v1
 *
 *   三个变量由平台写入项目根的 .env：网站运行时由 api/lib/env.ts 的 dotenv 加载；
 *   独立脚本（npx tsx xxx.ts）默认不会加载 .env —— 本模块会兜底调一次
 *   process.loadEnvFile()（Node >= 20.12；已存在的变量优先），仍读不到才报
 *   STORAGE_NOT_PROVISIONED。排查时先看 .env 里有没有 KIMI_，别急着说"平台没注入"。
 *   KIMI_STORAGE_RESOURCE_ID — 注入沙箱的本网站 resource ID（非敏感，不是凭据）
 *
 * 核心规则（违反会导致文件丢失或 403）：
 *   1. 上传 key 由 SDK 自动生成：在你给的 fileName 末段文件名后、扩展名前
 *      拼接 8 位随机后缀（如 avatars/photo.png → avatars/photo-a1b2c3d4.png），
 *      目录层级与扩展名不变，保证 key 不重复；同名 key 服务端会静默覆盖，
 *      需要指定固定 key 的场景不要用本 SDK 的自动生成
 *   2. 上传通过 AgentGW OSS 的 PUT 原始字节流，Content-Type 和 Content-Length
 *      必须随请求发送（缺失 → 400 STORAGE_INVALID_INPUT）
 *   3. 服务端两阶段写：先写暂存对象 → 同步审核 → 通过后 rename 到最终 key。
 *      审核不通过上传直接失败（403 STORAGE_REVIEW_REJECTED），对象不会留在存储里；
 *      暂存对象不会出现在列举结果中，无需客户端 confirm
 *   4. 访问文件一律用 getPresignedUrl 返回的平台门面 URL；不是 raw TOS URL
 *   5. 持久化（数据库、富文本、配置）只存 key，绝不存签名 URL——URL 会过期
 *   6. 单文件上限 100MB，由服务端在接收字节时强制（413 STORAGE_FILE_TOO_LARGE）
 *
 * 审核耗时（决定调用方超时设置，实测数据）：
 *   - 图片（image/jpeg、png、webp、gif、bmp）走图片审核，通常秒级返回；
 *   - 文档类（pdf / word / ppt / excel / zip / rar / txt / md / csv / rtf）走
 *     文件审核：提交后服务端轮询至终态再返回，对外表现为同步审核。实测一个
 *     20 字节 text/plain 上传耗时约 12 秒 —— 上传接口不要设 5s 级别的超时。
 *   - 其它类型（如音视频）不做内容审核，直接通过。
 *
 * key 规则（与服务端 kimifs `validateClientKey` 一致，不要比服务端更严）：
 *   1..512 字节、合法 UTF-8、不以 "/" 开头、不含 "//"、不含 "\"、
 *   不含 ".." 段、不含控制字符；中文/空格/emoji 均合法。
 */

// ---------- 运行环境适配 ----------
//
// 这里**不声明** process / Buffer 等全局（`declare const process` / `interface Buffer`），
// 否则会和 @types/node 的官方声明打架，也会让两套 fetch 类型（DOM lib vs undici）互斥。
// 环境变量用 globalThis 收窄读取，二进制统一用标准的 Uint8Array
// （Node 的 Buffer 就是 Uint8Array 的子类，调用方直接传 Buffer 依然成立）。

interface NodeLikeProcess {
  env?: Record<string, string | undefined>;
  /** Node >= 20.12：把 .env 加载进 process.env（已存在的变量优先，不会覆盖） */
  loadEnvFile?: (path?: string) => void;
}

let envFileLoaded = false;

function loadEnvFileOnce(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const proc = (globalThis as { process?: NodeLikeProcess }).process;
  if (typeof proc?.loadEnvFile !== "function") return;
  try {
    proc.loadEnvFile(); // 默认读 cwd 下的 .env
  } catch {
    // 没有 .env / 运行时不支持 —— 保持原样，走正常的"未供给"报错
  }
}

function readEnv(key: string): string | undefined {
  const proc = (globalThis as { process?: NodeLikeProcess }).process;
  const value = proc?.env?.[key];
  if (value !== undefined && value !== "") return value;
  // 平台把凭据写进项目根的 .env；应用侧由 api/lib/env.ts 的 dotenv 加载，
  // 但独立脚本（npx tsx xxx.ts）不会自动加载 —— 这里兜底加载一次，
  // 避免"平台其实已注入、只是脚本没读到"被误报成 STORAGE_NOT_PROVISIONED。
  loadEnvFileOnce();
  return proc?.env?.[key];
}

/**
 * fetch 请求体在「DOM lib」与「@types/node」两套类型定义下写法不同：
 * DOM 的 BufferSource 要求 `ArrayBufferView<ArrayBuffer>`，而我们接受任意
 * `Uint8Array`（可能是 `Uint8Array<ArrayBufferLike>`）。运行时 undici 与浏览器
 * 都接受 Uint8Array，所以在唯一收口处做一次断言，避免每个调用方改类型。
 */
type FetchBodyInit = NonNullable<RequestInit["body"]>;

function asFetchBody(body: Uint8Array): FetchBodyInit {
  return body as unknown as FetchBodyInit;
}


// ---------- 类型 ----------

/** 同步审核：上传成功即 active；审核拒绝则上传直接失败，对象不会存进来 */
export type ReviewStatus = "active";

export interface UploadFileInput {
  /** 文件内容：Uint8Array（Node 的 Buffer 即其子类，可直接传）或 utf-8 字符串 */
  fileContent: Uint8Array | string;
  /**
   * 对象 key：resource 内相对路径，可带 folder 前缀，如 "avatars/photo.png"。
   * 同名 key 会静默覆盖；需要保留历史版本时自己生成全新 key。
   */
  fileName: string;
  /** MIME 类型，缺省按扩展名推断，推断失败为 application/octet-stream */
  contentType?: string;
}

export interface UploadResult {
  /** 对象 key（SDK 生成：原始文件名末段拼 8 位后缀，层级/扩展名不变） */
  key: string;
  /** 存储侧文件名：key 末段（含 8 位后缀） */
  fileName: string;
  size: number;
  contentType: string;
  /** 内容 ETag（带引号，与服务端一致；可用于去重/缓存判断） */
  etag?: string;
  /** 上传成功即为 active；rejected 时上传直接抛错，不会拿到此结果 */
  reviewStatus: ReviewStatus;
}

export interface FileMeta {
  /** 对象 key；不是 fileName，也不是 URL */
  key: string;
  fileName?: string;
  size: number;
  contentType: string;
  etag?: string;
  lastModified?: string;
  reviewStatus: ReviewStatus;
}

export interface ListFilesInput {
  /** 目录前缀，如 "avatars/"（按目录列举时通常以 "/" 结尾，服务端不强制） */
  prefix?: string;
  /** 传 "/" 时只返回当前层级（folders + objects）；传 "" 扁平递归返回全部对象 */
  delimiter?: "/" | "";
  /** 单次最多返回条数，默认 100，上限 100 */
  maxKeys?: number;
  /** 翻页游标，取上一页返回的 nextPageToken */
  pageToken?: string;
}

export interface ListFilesResult {
  /** 子文件夹完整前缀（delimiter="/" 时返回，如 "avatars/raw/"） */
  folders: string[];
  /** 当前层级对象（delimiter="/" 时）；或 prefix 下全部对象（扁平递归时） */
  objects: FileMeta[];
  nextPageToken?: string;
}

export interface PresignedUrlResult {
  key: string;
  url: string;
  /** 签名失效时间（UTC，ISO8601）；服务端有效期 10 分钟 */
  expireTime?: string;
}

export interface DeleteFilesResult {
  deleted: string[];
  failed: { key: string; message: string }[];
}

// ---------- 错误 ----------

export type StorageErrorCode =
  | "STORAGE_NOT_PROVISIONED" // 存储未供给：完成一次发布后重试
  | "STORAGE_QUOTA_EXCEEDED" // 容量超限：提示用户升级/清理（默认配额 30GiB）
  | "STORAGE_REVIEW_REJECTED" // 审核不通过，上传被拒绝（403，重试无意义）
  | "STORAGE_OBJECT_NOT_FOUND" // key 不存在
  | "STORAGE_FILE_TOO_LARGE" // 超过 100MB
  | "STORAGE_INVALID_INPUT" // 参数非法（key、content-type 被拦、声明大小不符等）
  | "STORAGE_FORBIDDEN" // 无权访问 resource
  | "STORAGE_RESOURCE_FROZEN" // resource 已冻结
  | "STORAGE_RATE_LIMITED" // 网关限流
  | "STORAGE_UPSTREAM_ERROR"; // 下游异常（含审核服务不可用），可重试

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;
  /**
   * 服务端错误体只有 {"error":{"code","message"}}（AgentGW writeStorageError），
   * 没有诊断/请求 id 字段，因此这里不提供 diagnosticId —— 反馈问题时给 code + message 即可。
   */

  constructor(code: StorageErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

// ---------- 内部实现 ----------

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB，与服务端 profile.MaxFileBytes 一致
const MAX_LIST_PAGE_SIZE = 100;
const MAX_PRESIGNED_KEYS = 100;
const MAX_DELETE_KEYS = 100;
const KEY_MAX_BYTES = 512; // 服务端 validateClientKey 的上限（字节，含 UTF-8 多字节）
const PREFIX_MAX_BYTES = 512;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
  ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain",
  ".md": "text/markdown", ".csv": "text/csv", ".zip": "application/zip", ".glb": "model/gltf-binary",
};

/**
 * key / prefix 校验：与服务端 `validateClientKey` 同规则（不额外收紧）。
 * 服务端实测：中文+空格 key 上传 200；508 字节 key 通过、513 字节返回 400。
 */
function assertValidKey(key: string, label = "fileName"): void {
  const bytes = new TextEncoder().encode(key).length;
  if (!key || bytes > KEY_MAX_BYTES) {
    throw new StorageError("STORAGE_INVALID_INPUT", `${label} 为空或超过 ${KEY_MAX_BYTES} 字节`, false);
  }
  if (key.startsWith("/") || key.includes("//") || key.includes("\\")) {
    throw new StorageError("STORAGE_INVALID_INPUT", `${label} 不能以 / 开头，且不能包含 // 或 \\`, false);
  }
  if (key.split("/").includes("..")) {
    throw new StorageError("STORAGE_INVALID_INPUT", `${label} 不能包含 .. 段`, false);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(key)) {
    throw new StorageError("STORAGE_INVALID_INPUT", `${label} 不能包含控制字符`, false);
  }
}

function assertValidPrefix(prefix: string): void {
  if (!prefix) return;
  if (new TextEncoder().encode(prefix).length > PREFIX_MAX_BYTES) {
    throw new StorageError("STORAGE_INVALID_INPUT", `prefix 超过 ${PREFIX_MAX_BYTES} 字节`, false);
  }
  assertValidKey(prefix, "prefix");
}

function guessContentType(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_BY_EXT[fileName.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

function toBody(content: Uint8Array | string): { body: Uint8Array; size: number } {
  const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
  if (body.byteLength === 0) {
    throw new StorageError("STORAGE_INVALID_INPUT", "文件内容为空", false);
  }
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    throw new StorageError(
      "STORAGE_FILE_TOO_LARGE",
      `文件 ${(body.byteLength / 1024 / 1024).toFixed(1)}MB 超过 100MB 上限`,
      false,
    );
  }
  return { body, size: body.byteLength };
}

function lastSegment(key: string): string {
  const idx = key.lastIndexOf("/");
  return idx < 0 ? key : key.slice(idx + 1);
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** 8 位十六进制随机后缀（crypto.getRandomValues，浏览器/Node 20 均可用）。 */
function randomSuffix8(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 由 fileName 生成不重复 key：末段文件名后、扩展名前拼 8 位后缀，
 * 目录层级与扩展名不变。
 *   avatars/photo.png  → avatars/photo-a1b2c3d4.png
 *   report             → report-a1b2c3d4
 *   archive.tar.gz     → archive.tar-a1b2c3d4.gz（按最后一个 . 处理）
 *   avatars/报告.pdf    → avatars/报告-a1b2c3d4.pdf（非 ASCII 合法）
 */
function uniqueKey(fileName: string): string {
  const slash = fileName.lastIndexOf("/");
  const dir = slash < 0 ? "" : fileName.slice(0, slash + 1);
  const base = slash < 0 ? fileName : fileName.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const suffix = randomSuffix8();
  // 以点开头或无扩展名（如 ".env"、"report"）：整体视为文件名，直接拼后缀
  if (dot <= 0) return `${dir}${base}-${suffix}`;
  return `${dir}${base.slice(0, dot)}-${suffix}${base.slice(dot)}`;
}

interface ErrorBody {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

function toFileMeta(obj: {
  key?: string;
  fileName?: string;
  file_name?: string;
  contentType?: string;
  content_type?: string;
  etag?: string;
  sizeBytes?: string | number;
  size_bytes?: string | number;
  lastModifiedTime?: string;
  last_modified_time?: string;
}): FileMeta {
  const rawSize = obj.sizeBytes ?? obj.size_bytes ?? 0;
  const size = typeof rawSize === "string" ? Number(rawSize) : rawSize;
  return {
    key: obj.key ?? "",
    fileName: obj.fileName || obj.file_name || lastSegment(obj.key ?? ""),
    size,
    // 列表接口的 content_type 可能为空串，兜底 octet-stream
    contentType: obj.contentType || obj.content_type || "application/octet-stream",
    etag: obj.etag || undefined,
    lastModified: obj.lastModifiedTime || obj.last_modified_time,
    reviewStatus: "active",
  };
}

/** Connect 错误码 → SDK 错误码 */
function connectErrorToCode(connectCode: string | undefined, httpStatus: number): StorageErrorCode {
  switch (connectCode) {
    case "not_found":
      return "STORAGE_OBJECT_NOT_FOUND";
    case "failed_precondition":
      return "STORAGE_NOT_PROVISIONED";
    case "resource_exhausted":
      return "STORAGE_QUOTA_EXCEEDED";
    case "invalid_argument":
    case "out_of_range":
      return httpStatus === 413 ? "STORAGE_FILE_TOO_LARGE" : "STORAGE_INVALID_INPUT";
    case "permission_denied":
      return "STORAGE_FORBIDDEN";
    case "unauthenticated":
      return "STORAGE_NOT_PROVISIONED";
    default:
      // 无响应体（HEAD 请求）或错误体不合约定时的兜底：按 HTTP 状态码映射。
      // 主路径仍是服务端返回的 code（见 toError），这里只做兜底，不额外收紧。
      // 状态码取自 AgentGW ossErrorMapping（唯一事实来源）：
      // 400 INVALID_INPUT / 401+404 NOT_PROVISIONED / 403 FORBIDDEN·REVIEW_REJECTED /
      // 409 RESOURCE_FROZEN / 413 TOO_LARGE·QUOTA / 429 RATE_LIMITED / 502 UPSTREAM_ERROR。
      // 404 与 413 各自对应两个 code，客户端拿不到响应体时只能选更常见的那个。
      switch (httpStatus) {
        case 400:
          return "STORAGE_INVALID_INPUT";
        case 401:
          return "STORAGE_NOT_PROVISIONED";
        case 403:
          return "STORAGE_FORBIDDEN";
        case 404:
          return "STORAGE_OBJECT_NOT_FOUND";
        case 409:
          return "STORAGE_RESOURCE_FROZEN";
        case 413:
          return "STORAGE_FILE_TOO_LARGE";
        case 429:
          return "STORAGE_RATE_LIMITED";
        default:
          return "STORAGE_UPSTREAM_ERROR";
      }
  }
}

// ---------- SDK ----------

export class Storage {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly resourceId: string;

  /**
   * 无参构造即可：默认读 KIMI_AGENTGW_API_KEY / KIMI_AGENTGW_BASE_URL / KIMI_STORAGE_RESOURCE_ID。
   * apiKey 只在网站服务端可用；浏览器场景把文件提交给网站自己的后端接口，
   * 由后端调用本模块——不要把 apiKey 暴露给浏览器。
   *
   * KIMI_STORAGE_RESOURCE_ID 是平台注入的 resource ID，SDK 会把它放入
   * AgentGW OSS URL 的 resource_id 路径段；调用方不传、也不控制 resource_id。
   */
  constructor(opts?: { baseUrl?: string; apiKey?: string; resourceId?: string }) {
    const baseUrl = opts?.baseUrl ?? readEnv("KIMI_AGENTGW_BASE_URL");
    const apiKey = opts?.apiKey ?? readEnv("KIMI_AGENTGW_API_KEY");
    const resourceId = opts?.resourceId ?? readEnv("KIMI_STORAGE_RESOURCE_ID");
    if (!baseUrl || !apiKey || !resourceId) {
      throw new StorageError(
        "STORAGE_NOT_PROVISIONED",
        "缺少 KIMI_AGENTGW_BASE_URL / KIMI_AGENTGW_API_KEY / KIMI_STORAGE_RESOURCE_ID：网站未完成存储供给，请勿向用户索要密钥",
        false,
      );
    }
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    // fetch（Node/undici 与浏览器）只接受绝对 URL：注入值异常（相对路径 / 缺 scheme）时
    // 必须显式报"未供给/配置错误"，否则会被 catch 成可重试的 STORAGE_UPSTREAM_ERROR，
    // 把配置问题误导成服务端故障。
    if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
      throw new StorageError(
        "STORAGE_NOT_PROVISIONED",
        "KIMI_AGENTGW_BASE_URL 必须是绝对 URL（形如 https://agent-gw.kimi.com/coding/v1），当前注入值不是",
        false,
      );
    }
    this.baseUrl = normalizedBaseUrl;
    this.apiKey = apiKey;
    this.resourceId = resourceId;
  }

  /**
   * 上传文件：AgentGW OSS PUT 原始字节流（服务端流式写入 TOS → 同步审核 → 发布）。
   * 成功返回的对象即为 active；审核不通过抛 403 STORAGE_REVIEW_REJECTED；
   * 审核服务不可用抛 502 STORAGE_UPSTREAM_ERROR（可重试）。
   * 文档类内容审核是「异步方案、同步外观」，可能等待十几秒 —— 超时要留足。
   * 浏览器场景：把文件提交给网站自己的后端接口，由后端调用本方法——不要把 apiKey 暴露给浏览器。
   */
  async uploadFile(input: UploadFileInput): Promise<UploadResult> {
    assertValidKey(input.fileName);
    const { body, size } = toBody(input.fileContent);
    const contentType = input.contentType ?? guessContentType(input.fileName);
    const key = uniqueKey(input.fileName);
    // 自动后缀（-a1b2c3d4 共 9 字节）会让 key 比 fileName 长，所以必须在生成 key **之后**
    // 再校验一次长度：504~512 字节的 fileName 会在这里被拦下，而不是"客户端通过、服务端 400"。
    if (new TextEncoder().encode(key).length > KEY_MAX_BYTES) {
      throw new StorageError(
        "STORAGE_INVALID_INPUT",
        `生成后的 key 超过 ${KEY_MAX_BYTES} 字节，请缩短 fileName`,
        false,
      );
    }

    const res = await this.request(`/oss/${this.resourceId}/${encodeObjectKey(key)}`, {
      method: "PUT",
      body,
      contentType,
      contentLength: size,
    });
    const data = (await res.json()) as Parameters<typeof toFileMeta>[0];
    const meta = toFileMeta(data);
    return {
      key: meta.key || key,
      fileName: meta.fileName ?? lastSegment(key),
      size: meta.size || size,
      contentType: meta.contentType,
      etag: meta.etag,
      reviewStatus: "active",
    };
  }

  /** 读取文件字节（返回标准 Uint8Array；Node 下需要 Buffer 时 `Buffer.from(bytes)` 即可）。
   *  浏览器展示应直接使用 getPresignedUrl。 */
  async readFile(input: { fileKey: string }): Promise<Uint8Array> {
    const { url } = await this.getPresignedUrl({ key: input.fileKey });
    let res: Response;
    try {
      // 门面 URL 会 302 到短时 TOS 直链，fetch 默认跟随重定向
      res = await fetch(url);
    } catch (e) {
      throw new StorageError(
        "STORAGE_UPSTREAM_ERROR",
        `文件读取失败：${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    }
    if (!res.ok) {
      throw new StorageError(
        "STORAGE_UPSTREAM_ERROR",
        `文件读取失败：HTTP ${res.status}`,
        res.status >= 500,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * 返回平台门面 PresignedURL（kimifs 自有 HMAC 签名，请求时验签后 302 到短时 TOS GET）。
   * 不是 raw TOS URL；服务端签名有效期 10 分钟（TOS 直链更短），
   * 业务只持久化 key，渲染时动态获取。
   * download=true 时经 response-content-disposition 还原文件名（浏览器下载而非预览）。
   */
  async getPresignedUrl(input: { key: string; download?: boolean }): Promise<PresignedUrlResult> {
    assertValidKey(input.key, "key");
    const res = await this.request(`/oss/${this.resourceId}/${encodeObjectKey(input.key)}?presign=${input.download ? "true" : "false"}`, {
      method: "GET",
    });
    const data = (await res.json()) as { key?: string; url?: string; expire_time?: string };
    if (!data.url) {
      throw new StorageError("STORAGE_UPSTREAM_ERROR", `未返回 key ${input.key} 的签名 URL`, true);
    }
    return { key: data.key ?? input.key, url: data.url, expireTime: data.expire_time };
  }

  /** 批量获取签名 URL；部分失败不整体失败，见返回的 failures。 */
  async getPresignedUrls(input: { keys: string[]; download?: boolean }): Promise<{
    urls: PresignedUrlResult[];
    failures: { key: string; message: string }[];
  }> {
    if (!input.keys.length || input.keys.length > MAX_PRESIGNED_KEYS) {
      throw new StorageError("STORAGE_INVALID_INPUT", `keys 数量须为 1-${MAX_PRESIGNED_KEYS}`, false);
    }
    for (const key of input.keys) assertValidKey(key, "key");
    const res = await this.request(`/oss/${this.resourceId}?presign`, {
      method: "POST",
      json: { keys: input.keys, download: input.download ?? false },
    });
    const data = (await res.json()) as {
      urls?: { key?: string; url?: string; expire_time?: string }[];
      failures?: { key?: string; reason?: string }[];
    };
    return {
      urls: (data.urls ?? [])
        .filter((u): u is { key: string; url: string; expire_time?: string } => Boolean(u.key && u.url))
        .map((u) => ({ key: u.key, url: u.url, expireTime: u.expire_time })),
      // 服务端 failures[].reason 是内部原因枚举（如 REASON_STORAGE_OBJECT_NOT_FOUND）
      failures: (data.failures ?? []).map((f) => ({ key: f.key ?? "", message: f.reason ?? "unknown" })),
    };
  }

  /** @deprecated 使用 getPresignedUrl；返回平台门面 URL，不是 raw TOS presign。 */
  async generatePresignedUrl(input: { key: string; expireTime?: number }): Promise<string> {
    return (await this.getPresignedUrl({ key: input.key })).url;
  }

  /** 文件是否存在（active 对象）。 */
  async fileExists(input: { fileKey: string }): Promise<boolean> {
    try {
      await this.headFile(input);
      return true;
    } catch (e) {
      if (e instanceof StorageError && e.code === "STORAGE_OBJECT_NOT_FOUND") return false;
      throw e;
    }
  }

  /** 读取文件元信息（大小、类型、ETag、修改时间）。HEAD 无响应体，错误码按 HTTP 状态兜底。 */
  async headFile(input: { fileKey: string }): Promise<FileMeta> {
    assertValidKey(input.fileKey, "key");
    const res = await this.request(`/oss/${this.resourceId}/${encodeObjectKey(input.fileKey)}`, {
      method: "HEAD",
    });
    return {
      key: input.fileKey,
      fileName: lastSegment(input.fileKey),
      size: Number(res.headers.get("x-oss-size-bytes") ?? 0),
      contentType: res.headers.get("content-type") || "application/octet-stream",
      etag: res.headers.get("etag") || undefined,
      lastModified: res.headers.get("last-modified") || undefined,
      reviewStatus: "active",
    };
  }

  /**
   * 列举文件。delimiter="/" 时返回当前层级的子文件夹（folders）与对象（objects），
   * 用于按目录逐层浏览；delimiter="" 时扁平递归返回 prefix 下全部对象（Agent 常用）。
   */
  async listFiles(input: ListFilesInput = {}): Promise<ListFilesResult> {
    const prefix = input.prefix ?? "";
    assertValidPrefix(prefix);
    const delimiter = input.delimiter ?? "/";
    const query = new URLSearchParams({
      prefix,
      delimiter,
      "max-keys": String(Math.min(input.maxKeys ?? MAX_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE)),
    });
    if (input.pageToken) query.set("continuation-token", input.pageToken);
    const res = await this.request(`/oss/${this.resourceId}?${query.toString()}`, { method: "GET" });
    const data = (await res.json()) as {
      prefixes?: string[] | null;
      objects?: Parameters<typeof toFileMeta>[0][] | null;
      next_continuation_token?: string;
    };
    return {
      folders: data.prefixes ?? [],
      objects: (data.objects ?? []).map(toFileMeta),
      nextPageToken: data.next_continuation_token || undefined,
    };
  }

  /** 永久删除，不可恢复。删除幂等：不存在的 key 也按成功返回。 */
  async deleteFile(input: { fileKey: string }): Promise<boolean> {
    assertValidKey(input.fileKey, "key");
    await this.request(`/oss/${this.resourceId}/${encodeObjectKey(input.fileKey)}`, { method: "DELETE" });
    return true;
  }

  /**
   * 批量删除。返回每个 key 的结果，部分失败不整体失败。
   * 注意：服务端删除幂等，不存在的 key 也会出现在 deleted_keys 里、不算 failures。
   */
  async deleteFiles(input: { fileKeys: string[] }): Promise<DeleteFilesResult> {
    if (!input.fileKeys.length || input.fileKeys.length > MAX_DELETE_KEYS) {
      throw new StorageError("STORAGE_INVALID_INPUT", `fileKeys 数量须为 1-${MAX_DELETE_KEYS}`, false);
    }
    for (const key of input.fileKeys) assertValidKey(key, "key");
    const res = await this.request(`/oss/${this.resourceId}?delete`, {
      method: "POST",
      json: { keys: input.fileKeys },
    });
    const data = (await res.json()) as {
      deleted_keys?: string[];
      failures?: { key?: string; reason?: string }[];
    };
    const failures = (data.failures ?? []).map((f) => ({ key: f.key ?? "", message: f.reason ?? "unknown" }));
    const failedKeys = new Set(failures.map((f) => f.key));
    return { deleted: data.deleted_keys ?? input.fileKeys.filter((k) => !failedKeys.has(k)), failed: failures };
  }

  // ---------- 底层 ----------

  /** AgentGW OSS HTTP 调用：{baseUrl}/oss/{resource_id}/{key}
   *  baseUrl 是绝对 URL（形如 https://agent-gw.kimi.com/coding/v1），构造函数已校验。 */
  private async request(
    path: string,
    opts: {
      method: "GET" | "POST" | "PUT" | "HEAD" | "DELETE";
      json?: Record<string, unknown>;
      body?: Uint8Array;
      contentType?: string;
      contentLength?: number;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: "Bearer " + this.apiKey,
    };
    let body: FetchBodyInit | undefined;
    if (opts.body !== undefined) {
      body = asFetchBody(opts.body);
      headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
      headers["Content-Length"] = String(opts.contentLength ?? opts.body.byteLength);
    } else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: opts.method,
        headers,
        body,
      });
    } catch (e) {
      throw new StorageError(
        "STORAGE_UPSTREAM_ERROR",
        `存储服务不可达：${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    }
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  private async toError(res: Response): Promise<StorageError> {
    let parsed: ErrorBody = {};
    try {
      // HEAD 等无响应体的响应会解析失败，此时按 HTTP 状态码兜底
      parsed = (await res.json()) as ErrorBody;
    } catch {
      // 非 JSON 错误体 / 无响应体，按状态码兜底
    }
    // 服务端错误体（AgentGW writeStorageError）：{"error":{"code":"STORAGE_*","message":"..."}}；
    // 兼容少量旧路径直接返回 {"code","message"} 的形态。没有诊断 id 字段。
    const error = parsed.error ?? parsed;
    let code: StorageErrorCode;
    switch (error.code) {
      case "STORAGE_FORBIDDEN":
        code = "STORAGE_FORBIDDEN";
        break;
      case "STORAGE_RESOURCE_FROZEN":
        code = "STORAGE_RESOURCE_FROZEN";
        break;
      case "STORAGE_RATE_LIMITED":
        code = "STORAGE_RATE_LIMITED";
        break;
      case "STORAGE_REVIEW_REJECTED":
        code = "STORAGE_REVIEW_REJECTED";
        break;
      case "STORAGE_QUOTA_EXCEEDED":
        code = "STORAGE_QUOTA_EXCEEDED";
        break;
      case "STORAGE_FILE_TOO_LARGE":
        code = "STORAGE_FILE_TOO_LARGE";
        break;
      case "STORAGE_OBJECT_NOT_FOUND":
        code = "STORAGE_OBJECT_NOT_FOUND";
        break;
      case "STORAGE_NOT_PROVISIONED":
        code = "STORAGE_NOT_PROVISIONED";
        break;
      case "STORAGE_INVALID_INPUT":
        code = "STORAGE_INVALID_INPUT";
        break;
      default:
        code = connectErrorToCode(undefined, res.status);
    }
    // 只有"下游异常"可重试：同样是 5xx，配额的 507 / 冻结的 412 重试也不会好，
    // 把它们标成可重试会让调用方白白重试。
    const retryable = code === "STORAGE_UPSTREAM_ERROR";
    return new StorageError(code, error.message ?? `存储服务返回 ${res.status}`, retryable);
  }
}

/** 便捷单例：大多数网站直接 import { storage } 使用。
 *  惰性构造——import 时不读环境变量，首次调用方法时才初始化，
 *  避免未供给存储的网站仅仅因为 import 就启动失败。 */
let _instance: Storage | undefined;
export const storage: Storage = new Proxy({} as Storage, {
  get(_target, prop) {
    _instance ??= new Storage();
    const value = Reflect.get(_instance, prop);
    return typeof value === "function" ? value.bind(_instance) : value;
  },
});
