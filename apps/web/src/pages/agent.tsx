import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Empty, PageHeader } from '@/components/page';
import { api, post, type CheckReport, type DraftMeta, type TrialResult } from '@/lib/api';

export function AgentPage() {
  const qc = useQueryClient();
  const [requirement, setRequirement] = useState('');
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [detail, setDetail] = useState<DraftMeta | null>(null);
  const [check, setCheck] = useState<CheckReport | null>(null);
  const [trial, setTrial] = useState<TrialResult | null>(null);
  const [reason, setReason] = useState('');

  const { data: overview } = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<{ llmConfigured: boolean }>('/api/v1/admin/overview'),
  });

  const drafts = useQuery({
    queryKey: ['drafts'],
    queryFn: () => api<DraftMeta[]>('/api/v1/admin/drafts'),
  });

  const files = useQuery({
    queryKey: ['draft-files', detail?.slug],
    queryFn: () => api<{ meta: DraftMeta; files: Record<string, string> }>(`/api/v1/admin/drafts/${detail!.slug}`),
    enabled: !!detail,
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['drafts'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const gen = useMutation({
    mutationFn: () =>
      post<{ status: 'clarify'; questions: string[] } | { status: 'draft'; meta: DraftMeta }>(
        '/api/v1/admin/author',
        { requirement },
      ),
    onSuccess: async (r) => {
      if (r.status === 'clarify') {
        setQuestions(r.questions);
        toast.info('模型认为信息不足，请补充');
        return;
      }
      setQuestions(null);
      setRequirement('');
      toast.success(`草稿已生成：${r.meta.slug}`);
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const doCheck = useMutation({
    mutationFn: (slug: string) => post<CheckReport>(`/api/v1/admin/drafts/${slug}/check`),
    onSuccess: (r) => setCheck(r),
    onError: (e) => toast.error(e.message),
  });

  const doTrial = useMutation({
    mutationFn: (slug: string) => post<TrialResult>(`/api/v1/admin/drafts/${slug}/trial`, { seconds: 15 }),
    onSuccess: (r) => setTrial(r),
    onError: (e) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (slug: string) => post<DraftMeta>(`/api/v1/admin/drafts/${slug}/approve`),
    onSuccess: async () => {
      toast.success('已上线');
      setDetail(null);
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (slug: string) => post<DraftMeta>(`/api/v1/admin/drafts/${slug}/reject`, { reason }),
    onSuccess: async () => {
      toast.success('已驳回');
      setDetail(null);
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openDetail = (d: DraftMeta) => {
    setDetail(d);
    setCheck(null);
    setTrial(null);
    doCheck.mutate(d.slug);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent 生成"
        description="用一句话描述需求，让模型按接入规范生成监控程序；审核通过才上线"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">描述需求</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            rows={3}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="例：监控 GitHub 上 o/r 仓库 PR #123 的评论，有人回复就带着正文和链接通知我"
          />
          <div className="flex items-center gap-3">
            <Button disabled={!requirement || gen.isPending || !overview?.llmConfigured} onClick={() => gen.mutate()}>
              {gen.isPending ? '生成中…' : '生成草稿'}
            </Button>
            {overview && !overview.llmConfigured ? (
              <span className="text-sm text-muted-foreground">
                未配置模型：设置 <code>NOTIFY_LLM_MODEL</code> 后重启中心
              </span>
            ) : null}
          </div>
          {questions ? (
            <div className="rounded-md border border-dashed p-3 text-sm">
              <p className="font-medium">模型需要先澄清：</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">草稿</CardTitle>
        </CardHeader>
        <CardContent>
          {!drafts.data?.length ? (
            <Empty>还没有草稿。</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>需求</TableHead>
                  <TableHead>生成时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.data.map((d) => (
                  <TableRow key={d.slug}>
                    <TableCell className="font-medium">{d.slug}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'approved' ? 'default' : d.status === 'rejected' ? 'destructive' : 'secondary'}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">{d.requirement}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openDetail(d)}>
                        查看 / 审核
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.slug}</DialogTitle>
            <DialogDescription>{detail?.requirement}</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="files">
            <TabsList>
              <TabsTrigger value="files">代码</TabsTrigger>
              <TabsTrigger value="check">静态检查</TabsTrigger>
              <TabsTrigger value="trial">试运行</TabsTrigger>
            </TabsList>

            <TabsContent value="files" className="space-y-4">
              {Object.entries(files.data?.files ?? {}).map(([path, content]) => (
                <div key={path} className="space-y-2">
                  <p className="text-sm font-medium">{path}</p>
                  <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{content}</pre>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="check" className="space-y-2">
              {!check ? (
                <p className="text-sm text-muted-foreground">检查中…</p>
              ) : check.issues.length === 0 ? (
                <p className="text-sm">通过，无问题。</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {check.issues.map((i) => (
                    <li key={i.message} className={i.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                      [{i.level === 'error' ? '错误' : '提醒'}] {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="trial" className="space-y-3">
              <Button size="sm" variant="outline" disabled={doTrial.isPending} onClick={() => detail && doTrial.mutate(detail.slug)}>
                {doTrial.isPending ? '试运行中（最多 15s）…' : '跑一次试运行'}
              </Button>
              {trial ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    耗时 {(trial.durationMs / 1000).toFixed(1)}s · 退出 {trial.exitCode ?? trial.signal} · 心跳{' '}
                    {trial.heartbeatCount} 次 · 将会上报 {trial.events.length} 条
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(trial.events, null, 2)}
                  </pre>
                  {trial.stdout ? (
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{trial.stdout}</pre>
                  ) : null}
                </>
              ) : null}
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex w-full items-center gap-2">
              <input
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                placeholder="驳回理由（驳回时填）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={reject.isPending}
                onClick={() => detail && reject.mutate(detail.slug)}
              >
                驳回
              </Button>
            </div>
            <Button
              disabled={!check?.ok || approve.isPending || detail?.status === 'approved'}
              onClick={() => detail && approve.mutate(detail.slug)}
            >
              审核通过并上线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
