import { IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUploadRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contentType!: string;

  @IsInt()
  @IsPositive()
  sizeBytes!: number;
}
