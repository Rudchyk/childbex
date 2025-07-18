export interface ModelTimestamps {
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface ModelSoftDeleted {
  deletedAt?: Date | null;
}
