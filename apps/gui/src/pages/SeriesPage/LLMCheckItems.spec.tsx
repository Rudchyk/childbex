/**
 * The LLM check sends the Series context with the image ids: the server
 * verifies that every image belongs to that Series of that patient.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { LLMCheckItems } from './LLMCheckItems';

const mockCheck = jest.fn();
jest.mock('../../store/apis', () => ({
  useLlmServiceCheckItemsMutation: () => [mockCheck, { isLoading: false }],
}));
jest.mock('../../modules/notifications', () => ({
  useNotifications: () => ({ notifyError: jest.fn() }),
}));
jest.mock('../../components', () => ({ UIDialog: () => null }));

describe('LLMCheckItems', () => {
  it('sends the patient and Series with the image ids', () => {
    render(<LLMCheckItems patientId="p1" seriesId="s1" items={['i1', 'i2']} />);

    fireEvent.click(screen.getByRole('button', { name: /check/i }));

    expect(mockCheck).toHaveBeenCalledWith({
      patientId: 'p1',
      seriesId: 's1',
      imageIds: ['i1', 'i2'],
    });
  });
});
