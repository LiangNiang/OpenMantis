import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface SensitiveInputProps {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	className?: string
}

export function SensitiveInput({ value, onChange, placeholder, className }: SensitiveInputProps) {
	const [visible, setVisible] = useState(false)

	return (
		<div className="relative">
			<Input
				type={visible ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className={className}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="absolute right-1 top-1/2 -translate-y-1/2 size-7 p-0"
				onClick={() => setVisible(!visible)}
			>
				{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
			</Button>
		</div>
	)
}
