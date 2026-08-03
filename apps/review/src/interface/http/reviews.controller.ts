import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Body, Controller, Inject, Post } from '@nestjs/common';
import { SubmitReviewHandler } from '@review/application/submit-review.handler';
import type { ReviewResponse } from '@review/interface/http/dto/review.response';
import { SubmitReviewRequest } from '@review/interface/http/dto/submit-review.request';
import { ReviewResponseMapper } from '@review/interface/http/mappers/review-response.mapper';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly submitReview: SubmitReviewHandler,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  @Post()
  async submit(@Body() dto: SubmitReviewRequest): Promise<ReviewResponse> {
    const review = await this.submitReview.execute({
      tenantId: this.tenantContext.getTenantIdOrThrow(),
      userId: this.tenantContext.getActor(),
      orderId: dto.orderId,
      rating: dto.rating,
      comment: dto.comment,
    });
    return ReviewResponseMapper.toResponse(review);
  }
}
