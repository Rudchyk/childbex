'use client';

import { Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import {
  DataGrid,
  GridCellParams,
  GridColDef,
  GridRowId,
} from '@mui/x-data-grid';
import { FC, startTransition, useActionState, useEffect } from 'react';
import { AddUser } from './AddUser/AddUser';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
import { PublicUser, UserRoles } from '@/types';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import {
  UpdateUserData,
  UpdateUserActionState,
  updateUser,
} from './UpdateUser/updateUser.action';
import { UpdateUserActionStates } from './UpdateUser/UpdateUserActionStates.enum';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ChangeUserPassword } from './ChangeUserPassword/ChangeUserPassword';
import { roleValues } from '@/lib/constants/roleValues';
import { DeleteUser } from './DeleteUser/DeleteUser';

interface UsersProps {
  data: PublicUser[];
}

export const Users: FC<UsersProps> = ({ data }) => {
  const { notifyInfo, notifyError, notifySuccess, notifyWarning } =
    useNotifications();
  const session = useSession();
  const router = useRouter();
  const [state, formAction] = useActionState<
    UpdateUserActionState,
    UpdateUserData
  >(updateUser, {
    status: UpdateUserActionStates.IDLE,
  });
  const handleRowUpdate = async (
    updatedRow: PublicUser,
    originalRow: PublicUser,
    params: {
      rowId: GridRowId;
    }
  ): Promise<PublicUser> => {
    const update: UpdateUserData['data'] = {};
    const fieldsToUpdate: (keyof typeof update)[] = ['name', 'email', 'role'];

    fieldsToUpdate.forEach((key) => {
      if (updatedRow[key] !== originalRow[key]) {
        if (key === 'role') {
          if (session?.data?.user?.id !== params.rowId) {
            update[key] = updatedRow[key] as UserRoles;
          } else {
            alert('Unable to update the role!');
            router.refresh();
          }
        } else {
          update[key] = updatedRow[key];
        }
      }
    });

    if (Object.keys(update).length) {
      startTransition(() => {
        formAction({ id: params.rowId as string, data: update });
      });
    }

    return updatedRow;
  };
  const copyToClipboard = (text?: string | number) => {
    if (text) {
      navigator.clipboard.writeText(String(text));
      notifyInfo(`${text} was copied`);
    }
  };
  const getRoleChipColor = (role?: UserRoles) => {
    switch (role) {
      case UserRoles.ADMIN:
        return 'error';
      case UserRoles.SUPER:
        return 'primary';
      case UserRoles.USER:
      default:
        return 'default';
    }
  };
  const canEditCell = (params: GridCellParams<PublicUser>) => {
    if (
      params.field === 'role' &&
      session?.data?.user?.id === params.id &&
      params.row.role === UserRoles.SUPER
    ) {
      return false;
    }
    return true;
  };

  const columns: GridColDef<PublicUser>[] = [
    {
      field: 'id',
      headerName: 'ID',
      width: 50,
      renderCell: ({ value }: GridCellParams<PublicUser, PublicUser['id']>) => (
        <Stack justifyContent="center" alignItems="center" height="100%">
          <Tooltip title={value}>
            <IconButton onClick={() => copyToClipboard(value)}>
              <Grid3x3Icon />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
    {
      field: 'email',
      headerName: 'Email',
      width: 250,
      editable: true,
      renderCell: ({
        value,
      }: GridCellParams<PublicUser, PublicUser['email']>) => (
        <Stack
          direction="row"
          justifyContent="space-between"
          spacing={1}
          alignItems="center"
          height="100%"
        >
          <Tooltip title={value}>
            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
              {value}
            </Typography>
          </Tooltip>
          <IconButton size="small" onClick={() => copyToClipboard(value)}>
            <ContentCopyIcon />
          </IconButton>
        </Stack>
      ),
    },
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      editable: true,
    },
    {
      field: 'role',
      headerName: 'Role',
      width: 130,
      type: 'singleSelect',
      valueOptions: roleValues,
      editable: true,
      renderCell: ({
        value,
      }: GridCellParams<PublicUser, PublicUser['role']>) => (
        <Chip label={value?.toUpperCase()} color={getRoleChipColor(value)} />
      ),
    },
    {
      field: 'createdAt',
      headerName: 'Created At',
      flex: 1,
      valueFormatter: (value: PublicUser['createdAt']) =>
        value ? format(value, 'dd/MM/yyyy, HH:mm:ss') : '',
    },
    {
      field: 'changePassword',
      headerName: 'Password',
      flex: 1,
      renderCell: ({ id, row }: GridCellParams<PublicUser, PublicUser['id']>) =>
        row?.role !== UserRoles.SUPER && (
          <ChangeUserPassword id={id as string} />
        ),
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      getActions: ({ id, row }) => {
        const actions = [];
        if (row.role !== UserRoles.SUPER || id !== session?.data?.user?.id) {
          actions.push(<DeleteUser key={id} id={id as string} />);
        }
        return actions;
      },
    },
  ];

  useEffect(() => {
    switch (state.status) {
      case UpdateUserActionStates.USER_DO_NOT_EXIST:
        notifyWarning('Account do not exist!');
        break;
      case UpdateUserActionStates.FAILED:
        notifyError('Failed to updated account!');
        console.error(state.message);
        break;
      case UpdateUserActionStates.NOTHING_TO_UPDATE:
        notifyWarning('Nothing to update in account!');
        break;
      case UpdateUserActionStates.UNABLE_TO_UPDATE:
        notifyWarning('Unable to update account!');
        break;
      case UpdateUserActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case UpdateUserActionStates.SUCCESS:
        notifySuccess('User updated successfully!');
        break;
      default:
        break;
    }
    if (
      ![UpdateUserActionStates.SUCCESS, UpdateUserActionStates.IDLE].includes(
        state.status
      )
    ) {
      router.refresh();
    }
  }, [state]);

  return (
    <Stack component={Paper}>
      <DataGrid
        processRowUpdate={handleRowUpdate}
        disableRowSelectionOnClick
        rows={data}
        slots={{ toolbar: AddUser }}
        showToolbar
        columns={columns}
        isCellEditable={canEditCell}
      />
    </Stack>
  );
};
