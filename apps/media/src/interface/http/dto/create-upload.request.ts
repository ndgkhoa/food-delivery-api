import { IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Boundary validation for a new upload. The MIME allowlist + byte ceiling are
 * enforced deeper in the domain (`assertAllowedUpload`); these checks reject
 * obviously malformed input before it reaches a use case.
 */
export class CreateUploadRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contentType!: string;

  @IsInt()
  @IsPositive()
  sizeBytes!: number;
}
