/**
 * Param/query DTOs for the support-chat controllers.
 *
 * These must be classes, not inline object types. routing-controllers-openapi
 * resolves `@Params()`/`@QueryParams()` to a schema `$ref` derived from the
 * parameter's runtime type; an inline object literal reflects as `Object`,
 * leaving `$ref` undefined, and generateSpec dereferences it without a guard —
 * which crashes OpenAPI generation at boot for every route in the app.
 */
import { IsOptional, IsString } from 'class-validator';

export class SupportQuestionIdParams {
  @IsString()
  questionId!: string;
}

export class SupportFaqIdParams {
  @IsString()
  faqId!: string;
}

export class ChatMessageQuery {
  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  courseVersionId?: string;

  @IsOptional()
  @IsString()
  cohortId?: string;
}

export class ChatHistoryQuery {
  // Kept as a string: the controller parses it with parseInt.
  @IsOptional()
  @IsString()
  limit?: string;
}

export class FaqSearchQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class AdminDashboardQuery {
  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class AdminQuestionsQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  courseId?: string;
}

export class AdminFaqsQuery {
  @IsOptional()
  @IsString()
  category?: string;
}
