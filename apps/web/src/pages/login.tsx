import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRingIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { post } from '@/lib/api';

export function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const login = useMutation({
    mutationFn: () => post<{ ok: true }>('/api/v1/auth/login', { username, password }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
  });

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BellRingIcon className="size-5" />
          </div>
          <CardTitle>登录 notify-hub</CardTitle>
          <CardDescription>用中心上创建的用户登录管理界面</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {login.isError ? <p className="text-sm text-destructive">{login.error.message}</p> : null}
            <Button type="submit" className="w-full" disabled={login.isPending || !password}>
              {login.isPending ? '登录中…' : '登录'}
            </Button>
            <p className="text-xs text-muted-foreground">
              还没有用户？在中心执行 <code>pnpm cli user init</code> 创建。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
