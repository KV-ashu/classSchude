import { model, Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface CourseDoc {
  userId: Types.ObjectId;
  name: string;
  code: string;
  /** Free-form aliases ("DBMS", "Database") that feed the relevance classifier. */
  aliases: string[];
  defaultRoom?: string;
  defaultDurationMin?: number;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<CourseDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
    aliases: {
      type: [String],
      default: [],
      set: (aliases: string[]) =>
        aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    },
    defaultRoom: { type: String, trim: true, maxlength: 40 },
    defaultDurationMin: { type: Number, min: 5, max: 480 },
    color: { type: String, trim: true, maxlength: 24 },
  },
  { timestamps: true },
);

courseSchema.index({ userId: 1, code: 1 }, { unique: true });

export type CourseDocument = HydratedDocument<CourseDoc>;
export const Course: Model<CourseDoc> = model<CourseDoc>('Course', courseSchema);
