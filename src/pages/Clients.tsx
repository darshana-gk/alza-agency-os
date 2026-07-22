import { Users, Plus } from 'lucide-react'

const customers = [
  {
    id: 1,
    name: 'ABC Construction LLC',
    contact: 'John Miller',
    phone: '(555) 123-4567',
    email: 'john@abcconstruction.com',
    producer: 'Michael Johnson',
    policies: 3,
    premium: '$42,500',
  },
  {
    id: 2,
    name: 'Sunrise Roofing Inc',
    contact: 'David Smith',
    phone: '(555) 234-5678',
    email: 'info@sunriseroofing.com',
    producer: 'Sarah Wilson',
    policies: 2,
    premium: '$18,900',
  },
]

export function Clients() {
  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          <p className="text-gray-500">
            Manage all customer accounts and policies.
          </p>
        </div>

        <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          <Plus size={18} />
          Add Customer
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white shadow">
        <table className="min-w-full">

          <thead className="bg-gray-100">
            <tr className="text-left">
              <th className="px-6 py-3">Customer</th>
              <th className="px-6 py-3">Contact</th>
              <th className="px-6 py-3">Producer</th>
              <th className="px-6 py-3">Policies</th>
              <th className="px-6 py-3">Annual Premium</th>
            </tr>
          </thead>

          <tbody>
            {customers.map((customer) => (
              <tr
                key={customer.id}
                className="border-t hover:bg-gray-50"
              >
                <td className="px-6 py-4 font-medium">
                  {customer.name}
                </td>

                <td className="px-6 py-4">
                  <div>{customer.contact}</div>
                  <div className="text-sm text-gray-500">
                    {customer.email}
                  </div>
                  <div className="text-sm text-gray-500">
                    {customer.phone}
                  </div>
                </td>

                <td className="px-6 py-4">
                  {customer.producer}
                </td>

                <td className="px-6 py-4">
                  {customer.policies}
                </td>

                <td className="px-6 py-4 font-semibold">
                  {customer.premium}
                </td>
              </tr>
            ))}
          </tbody>

        </table>
      </div>

    </div>
  )
}