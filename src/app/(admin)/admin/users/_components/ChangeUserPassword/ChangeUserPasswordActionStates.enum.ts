export enum ChangePasswordProfileActionStates {
  IDLE = 'idle',
  SUCCESS = 'success',
  FAILED = 'failed',
  INVALID_DATA = 'invalid_data',
  USER_DO_NOT_EXIST = 'user_do_not_exist',
  OLD_PASSWORD_IS_WRONG = 'old_password_is_wrong',
}
