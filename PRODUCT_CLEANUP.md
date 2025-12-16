# 제품 자동 삭제 기능

## 구현된 기능

### 1. 제품 삭제 시 이미지 파일 자동 삭제
- 사용자가 제품을 삭제하면 `/uploads/` 폴더의 이미지 파일도 함께 삭제됩니다
- 외부 URL(http://, https://)은 삭제하지 않습니다

### 2. 판매완료 상품 자동 삭제
- 제품 상태가 "sold"로 변경되면 `soldAt` 타임스탬프가 기록됩니다
- 스케줄러가 5분마다 실행되어 `soldAt`이 1시간 이전인 제품을 자동 삭제합니다
- 삭제 시 제품의 이미지 파일도 함께 삭제됩니다

## 데이터베이스 스키마 변경

Product 모델에 `soldAt` 필드가 추가되었습니다:
```typescript
soldAt: { type: Date, default: null, index: true }
```

## 동작 방식

1. **판매완료 처리**
   - 사용자가 케밥 메뉴에서 "판매완료" 클릭
   - `PATCH /api/products/:id` 요청으로 `status: "sold"` 전송
   - 서버에서 `soldAt`을 현재 시간으로 설정

2. **자동 삭제**
   - 서버 시작 시 스케줄러 자동 실행
   - 5분마다 `soldAt`이 1시간 이전인 제품 검색
   - 해당 제품의 이미지 파일 삭제
   - 제품 데이터 삭제

3. **수동 삭제**
   - 사용자가 케밥 메뉴에서 "삭제" 클릭
   - `DELETE /api/products/:id` 요청
   - 제품의 이미지 파일 삭제
   - 제품 데이터 삭제

## 로그 확인

서버 콘솔에서 다음과 같은 로그를 확인할 수 있습니다:

```
[SCHEDULER] Product cleanup scheduler started
[SCHEDULER] Found 3 sold products to delete
[SCHEDULER] Image deleted: /path/to/uploads/image1.jpg
[SCHEDULER] Deleted sold product: 507f1f77bcf86cd799439011 - 중고 노트북
[SCHEDULER] Cleanup completed: 3 products deleted
```

## 테스트 방법

1. 제품을 등록합니다
2. 마이페이지에서 케밥 메뉴를 열고 "판매완료"를 클릭합니다
3. 1시간 후 (또는 테스트를 위해 `productScheduler.ts`의 시간을 조정) 제품이 자동으로 삭제됩니다
4. 또는 즉시 삭제하려면 케밥 메뉴에서 "삭제"를 클릭합니다

## 주의사항

- 스케줄러는 서버가 실행 중일 때만 작동합니다
- 서버가 재시작되면 스케줄러도 다시 시작됩니다
- 이미지 파일 삭제 실패 시에도 제품 데이터는 삭제됩니다
