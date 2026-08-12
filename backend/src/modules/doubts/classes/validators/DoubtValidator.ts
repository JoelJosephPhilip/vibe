import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {JSONSchema} from 'class-validator-jsonschema';

const STATUS_VALUES = ['OPEN', 'RESOLVED'] as const;
type StatusLiteral = (typeof STATUS_VALUES)[number];

const STATUS_FILTER_VALUES = ['OPEN', 'RESOLVED', 'ALL'] as const;
type StatusFilterLiteral = (typeof STATUS_FILTER_VALUES)[number];

export class DoubtItemPathParams {
  @IsMongoId()
  @JSONSchema({description: 'The video item the doubts belong to.'})
  itemId!: string;
}

export class DoubtIdPathParams {
  @IsMongoId()
  @JSONSchema({description: 'The doubt being acted on.'})
  doubtId!: string;
}

export class DoubtCoursePathParams {
  @IsMongoId()
  courseId!: string;

  @IsMongoId()
  courseVersionId!: string;
}

export class CreateDoubtBody {
  @IsMongoId()
  @JSONSchema({description: 'Course the item belongs to.'})
  courseId!: string;

  @IsMongoId()
  @JSONSchema({description: 'Course version the item belongs to.'})
  courseVersionId!: string;

  @IsOptional()
  @IsMongoId()
  cohortId?: string;

  @IsOptional()
  @IsMongoId()
  moduleId?: string;

  @IsOptional()
  @IsMongoId()
  sectionId?: string;

  @IsNumber()
  @Min(0)
  @Max(86400)
  @JSONSchema({
    description:
      'Seconds into the video the doubt refers to. Display metadata only — never used for access control.',
    example: 92.4,
  })
  videoTimestamp!: number;

  @IsString()
  @IsNotEmpty()
  @Length(1, 2000)
  @JSONSchema({
    description: 'The doubt text (1-2000 characters).',
    example: 'Why does this loop run twice?',
  })
  content!: string;
}

export class CreateDoubtReplyBody {
  @IsString()
  @IsNotEmpty()
  @Length(1, 2000)
  @JSONSchema({description: 'Reply text (1-2000 characters).'})
  content!: string;
}

export class UpdateDoubtStatusBody {
  @IsString()
  @IsIn([...STATUS_VALUES])
  @JSONSchema({
    description: 'New status for the doubt.',
    enum: [...STATUS_VALUES],
  })
  status!: StatusLiteral;
}

export class UpdateDoubtHiddenBody {
  @IsBoolean()
  @JSONSchema({description: 'Whether the doubt should be hidden from students.'})
  isHidden!: boolean;
}

export class DoubtListQuery {
  // Carried in the query string (not the path) purely so the controller can run
  // the course-scoped permission check before returning anything.
  @IsMongoId()
  courseId!: string;

  @IsMongoId()
  courseVersionId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @JSONSchema({description: 'Max doubts to return. Defaults to 100.'})
  limit?: number;
}

export class DoubtCourseListQuery {
  @IsOptional()
  @IsString()
  @IsIn([...STATUS_FILTER_VALUES])
  @JSONSchema({
    description: 'Filter by status. Defaults to ALL.',
    enum: [...STATUS_FILTER_VALUES],
  })
  status?: StatusFilterLiteral;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class DoubtReplyResponse {
  @IsString()
  _id!: string;

  @IsString()
  userId!: string;

  @IsString()
  userName!: string;

  @IsString()
  role!: 'STUDENT' | 'INSTRUCTOR';

  @IsString()
  content!: string;

  @IsBoolean()
  isHidden!: boolean;

  @IsString()
  createdAt!: string;
}

export class DoubtResponse {
  @IsString()
  _id!: string;

  @IsString()
  itemId!: string;

  @IsString()
  courseId!: string;

  @IsString()
  courseVersionId!: string;

  // Needed by the instructor "View" action: the item-fetch endpoint is keyed by
  // module + section, not itemId alone.
  @IsOptional()
  @IsString()
  moduleId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsString()
  userId!: string;

  @IsString()
  userName!: string;

  @IsNumber()
  videoTimestamp!: number;

  @IsString()
  content!: string;

  @IsString()
  status!: StatusLiteral;

  @IsBoolean()
  isHidden!: boolean;

  @IsString()
  createdAt!: string;

  replies!: DoubtReplyResponse[];
}

export class DoubtListResponse {
  items!: DoubtResponse[];
}
