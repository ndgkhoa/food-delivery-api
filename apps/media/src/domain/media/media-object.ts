export enum MediaStatus {
  PENDING = 'PENDING',
  UPLOADED = 'UPLOADED',
  READY = 'READY',
}

export interface MediaObjectProps {
  id: string;
  tenantId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  status: MediaStatus;
  thumbnailKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMediaObjectProps {
  id: string;
  tenantId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
}

export class MediaObject {
  private constructor(private readonly props: MediaObjectProps) {}

  static create(props: CreateMediaObjectProps): MediaObject {
    const now = new Date();
    return new MediaObject({
      id: props.id,
      tenantId: props.tenantId,
      objectKey: props.objectKey,
      contentType: props.contentType,
      sizeBytes: props.sizeBytes,
      status: MediaStatus.PENDING,
      thumbnailKey: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: MediaObjectProps): MediaObject {
    return new MediaObject(props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  get contentType(): string {
    return this.props.contentType;
  }

  get sizeBytes(): number {
    return this.props.sizeBytes;
  }

  get status(): MediaStatus {
    return this.props.status;
  }

  get thumbnailKey(): string | null {
    return this.props.thumbnailKey;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isPending(): boolean {
    return this.props.status === MediaStatus.PENDING;
  }

  get isReady(): boolean {
    return this.props.status === MediaStatus.READY;
  }

  markUploaded(): MediaObject {
    return new MediaObject({ ...this.props, status: MediaStatus.UPLOADED, updatedAt: new Date() });
  }

  markReady(thumbnailKey: string): MediaObject {
    return new MediaObject({
      ...this.props,
      status: MediaStatus.READY,
      thumbnailKey,
      updatedAt: new Date(),
    });
  }
}
