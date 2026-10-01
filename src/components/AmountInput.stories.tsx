import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import AmountInput from './AmountInput';

const meta: Meta<typeof AmountInput> = {
  title: 'Components/Forms/AmountInput',
  component: AmountInput,
  tags: ['autodocs'],
  argTypes: {
    onChange: { action: 'changed' },
    onValidityChange: { action: 'validityChanged' },
  },
  args: {
    value: '',
    balance: 1000,
    currencyLabel: 'USDC',
  },
}

export default meta
type Story = StoryObj<typeof AmountInput>

export const Default: Story = {
  args: {
    value: '',
  },
}

export const Filled: Story = {
  args: {
    value: '500.00',
  },
}

export const OverBalance: Story = {
  args: {
    value: '1500.00',
    balance: 1000,
  },
}

export const Error: Story = {
  args: {
    value: '5.00',
    error: 'Minimum bond is 10 USDC',
  },
}

export const Disabled: Story = {
  args: {
    value: '100.00',
    disabled: true,
  },
}

export const Loading: Story = {
  args: {
    isLoading: true,
  },
}

export const BelowMin: Story = {
  name: 'Below minimum',
  args: {
    value: '5.00',
    balance: 1000,
    min: 10,
  },
  render: function BelowMinInteractive(args) {
    const [value, setValue] = React.useState(args.value);
    return <AmountInput {...args} value={value} onChange={setValue} />;
  },
};

/**
 * Boundary and recovery coverage for the amount state machine.
 * These stories keep the entered value visible while exercising the same
 * failure paths used by the Max request in production.
 */
export const EmptyBoundary: Story = {
  name: 'Boundary – empty amount',
  args: {
    value: '',
  },
}

export const ExactBalanceBoundary: Story = {
  name: 'Boundary – exact balance',
  args: {
    value: '1000.00',
    balance: 1000,
  },
}

export const MinimumBoundary: Story = {
  name: 'Boundary – minimum amount',
  args: {
    value: '10.00',
    min: 10,
  },
}

export const OverBalanceBoundary: Story = {
  name: 'Boundary – over balance',
  args: {
    value: '1000.01',
    balance: 1000,
  },
}

export const LoadingRecovery: Story = {
  name: 'Recovery – loading to success',
  render: function LoadingRecoveryStory(args) {
    const [value, setValue] = React.useState(args.value)
    const [loading, setLoading] = React.useState(true)

    React.useEffect(() => {
      const timer = window.setTimeout(() => setLoading(false), 900)
      return () => window.clearTimeout(timer)
    }, [])

    return <AmountInput {...args} value={value} onChange={setValue} isLoading={loading} />
  },
  args: {
    value: '',
  },
}

export const RetryAfterFailure: Story = {
  name: 'Recovery – retry after failure',
  render: function RetryAfterFailureStory(args) {
    const [value, setValue] = React.useState(args.value)
    const attempts = React.useRef(0)

    const onMaxRequest = React.useCallback(async () => {
      attempts.current += 1
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      if (attempts.current === 1) throw new Error('Temporary balance service failure')
      return 750
    }, [])

    return (
      <AmountInput
        {...args}
        value={value}
        onChange={setValue}
        onMaxRequest={onMaxRequest}
      />
    )
  },
  args: {
    value: '',
    balance: 1000,
  },
}

export const PermissionDenied: Story = {
  name: 'Recovery – permission denied',
  args: {
    value: '250.00',
    onMaxRequest: async () => {
      const error = new Error('Wallet permission denied')
      error.name = 'PermissionError'
      throw error
    },
  },
}

export const StaleBalance: Story = {
  name: 'Recovery – stale balance',
  args: {
    value: '250.00',
    onMaxRequest: async () => {
      const error = new Error('Balance data is stale')
      error.name = 'StaleDataError'
      throw error
    },
  },
}
