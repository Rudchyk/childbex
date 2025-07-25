export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

export interface SoftDeletion {
  deletedAt: Date | null;
}
